using System.Reflection;
using System.Runtime.InteropServices;
using PDFtoImage;
using SkiaSharp;

namespace DocumentOcr.Infrastructure;

internal static class NativeDependencyLoader
{
    private static int _skiaResolverConfigured;
    private static int _pdfiumResolverConfigured;

    public static void EnsureSkiaSharp()
    {
        ConfigureResolverOnce(typeof(SKBitmap).Assembly, ref _skiaResolverConfigured, "libSkiaSharp");
    }

    public static void EnsurePdfium()
    {
        ConfigureResolverOnce(typeof(Conversion).Assembly, ref _pdfiumResolverConfigured, "pdfium");
    }

    private static void ConfigureResolverOnce(Assembly assembly, ref int configuredFlag, string expectedLibraryName)
    {
        if (Interlocked.Exchange(ref configuredFlag, 1) != 0)
        {
            return;
        }

        try
        {
            NativeLibrary.SetDllImportResolver(
                assembly,
                (libraryName, targetAssembly, searchPath) =>
                {
                    if (!IsExpectedLibrary(libraryName, expectedLibraryName))
                    {
                        return IntPtr.Zero;
                    }

                    var nativePath = ResolveNativePath(targetAssembly, expectedLibraryName);
                    return nativePath is null
                        ? IntPtr.Zero
                        : NativeLibrary.Load(nativePath, targetAssembly, searchPath);
                });
        }
        catch (InvalidOperationException)
        {
            // Another host-level resolver is already registered for this assembly.
        }
    }

    private static bool IsExpectedLibrary(string libraryName, string expectedLibraryName)
    {
        var normalizedLibraryName = Path.GetFileNameWithoutExtension(libraryName);
        return string.Equals(normalizedLibraryName, expectedLibraryName, StringComparison.OrdinalIgnoreCase);
    }

    private static string? ResolveNativePath(Assembly targetAssembly, string nativeLibraryName)
    {
        var nativeFileName = $"{nativeLibraryName}.dll";
        var assemblyDirectory = ResolveAssemblyDirectory();
        var rid = Environment.Is64BitProcess ? "win-x64" : "win-x86";
        var architectureDirectory = Environment.Is64BitProcess ? "x64" : "x86";

        var candidatePaths = new[]
        {
            Path.Combine(assemblyDirectory, nativeFileName),
            Path.Combine(assemblyDirectory, "runtimes", rid, "native", nativeFileName),
            Path.Combine(assemblyDirectory, architectureDirectory, nativeFileName),
            Path.Combine(ResolveAssemblyDirectory(targetAssembly), nativeFileName),
            Path.Combine(ResolveAssemblyDirectory(targetAssembly), "runtimes", rid, "native", nativeFileName),
        };

        return candidatePaths.FirstOrDefault(File.Exists);
    }

    private static string ResolveAssemblyDirectory()
    {
        return ResolveAssemblyDirectory(typeof(NativeDependencyLoader).Assembly);
    }

    private static string ResolveAssemblyDirectory(Assembly assembly)
    {
        var assemblyLocation = assembly.Location;

        if (!string.IsNullOrWhiteSpace(assemblyLocation))
        {
            return Path.GetDirectoryName(assemblyLocation)
                ?? throw new InvalidOperationException("The assembly directory could not be determined.");
        }

        return AppContext.BaseDirectory;
    }
}
