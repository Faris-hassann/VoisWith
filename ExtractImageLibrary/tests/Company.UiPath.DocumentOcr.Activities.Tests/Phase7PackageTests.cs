using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace Company.UiPath.DocumentOcr.Activities.Tests;

public sealed class Phase7PackageTests
{
    private const string PackageId = "Company.UiPath.DocumentOcr.Activities";
    private const string PackageVersion = "1.0.5";
    private const string TargetFramework = "net6.0";
    private const string PackageFileName = $"{PackageId}.{PackageVersion}.nupkg";

    [Fact]
    public void Package_HasExpectedIdentityFrameworkAndMetadata()
    {
        using var package = OpenPackage();
        using var nuspecStream = OpenEntry(package, $"{PackageId}.nuspec");
        var nuspec = XDocument.Load(nuspecStream);
        var metadata = Metadata(nuspec);

        Assert.Equal(PackageFileName, Path.GetFileName(PackagePath));
        Assert.Equal(PackageId, ElementValue(metadata, "id"));
        Assert.Equal(PackageVersion, ElementValue(metadata, "version"));
        Assert.Equal("Document OCR Activities for UiPath", ElementValue(metadata, "title"));
        Assert.Equal("Document OCR Contributors", ElementValue(metadata, "authors"));
        var repository = metadata.Elements().SingleOrDefault(element => element.Name.LocalName == "repository");
        Assert.NotNull(repository);
        Assert.Equal("git", repository!.Attribute("type")?.Value);
        Assert.Equal("https://github.com/Faris-hassann/VoisWith.git", repository.Attribute("url")?.Value);
        Assert.DoesNotContain(metadata.Elements(), element => element.Name.LocalName == "license");
        Assert.DoesNotContain(metadata.Elements(), element => element.Name.LocalName == "copyright");
        Assert.Contains(package.Entries, entry => entry.FullName == $"lib/{TargetFramework}/Company.UiPath.DocumentOcr.Activities.dll");
    }

    [Fact]
    public void Package_NuspecContainsExactRuntimeDependenciesOnly()
    {
        using var package = OpenPackage();
        using var nuspecStream = OpenEntry(package, $"{PackageId}.nuspec");
        var dependencyGroup = Metadata(XDocument.Load(nuspecStream))
            .Descendants()
            .Single(element => element.Name.LocalName == "group" && element.Attribute("targetFramework")?.Value == "net6.0");

        var dependencies = dependencyGroup.Elements()
            .Where(element => element.Name.LocalName == "dependency")
            .ToDictionary(
                element => element.Attribute("id")?.Value ?? string.Empty,
                element => element.Attribute("version")?.Value ?? string.Empty);

        Assert.Equal("[1.20260609.1]", dependencies["System.Activities.ViewModels"]);
        Assert.Equal("[5.2.1]", dependencies["PDFtoImage"]);
        Assert.Equal("[3.119.4]", dependencies["SkiaSharp"]);
        Assert.Equal("[2.4.660]", dependencies["BitMiracle.LibTiff.NET"]);
        Assert.Equal("[5.2.0]", dependencies["Tesseract"]);
        Assert.DoesNotContain("UiPath.Activities.Api", dependencies.Keys);
        Assert.DoesNotContain("UiPath.Workflow", dependencies.Keys);
        Assert.DoesNotContain(dependencies.Keys, key => key.Contains("Test", StringComparison.OrdinalIgnoreCase) || key.Contains("xunit", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Package_ContainsProjectAssembliesUnderLib()
    {
        using var package = OpenPackage();

        AssertEntry(package, $"lib/{TargetFramework}/Company.UiPath.DocumentOcr.Activities.dll");
        AssertEntry(package, $"lib/{TargetFramework}/DocumentOcr.Core.dll");
        AssertEntry(package, $"lib/{TargetFramework}/DocumentOcr.Infrastructure.dll");
    }

    [Fact]
    public void Package_ContainsPinnedTessDataAtExpectedPath()
    {
        using var package = OpenPackage();
        var entry = AssertEntry(package, $"lib/{TargetFramework}/TessData/eng.traineddata");

        Assert.Equal(4_113_088, entry.Length);
        Assert.Equal("7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2", Sha256(entry));
        AssertEntry(package, $"lib/{TargetFramework}/TessData/LICENSE.tessdata_fast.txt");
    }

    [Fact]
    public void Package_ContainsExpectedTesseractNativeAssets()
    {
        using var package = OpenPackage();

        AssertNative(package, $"lib/{TargetFramework}/x64/tesseract50.dll", 2_788_352, "DE4D04EC75095374D98F5DD7A60D14D7E2E0F76589DB693ECCF7AE658BE8CB2B", 0x8664);
        AssertNative(package, $"lib/{TargetFramework}/x64/leptonica-1.82.0.dll", 4_168_192, "DFCB3E6ED0B16BC55BFDBCF53543CFE42A354B87C3E35BD3A95EEBF005D73E76", 0x8664);
        AssertNative(package, $"lib/{TargetFramework}/x86/tesseract50.dll", 2_336_768, "7F4873CDB78B9CD18C069EAE434D38DD14E987531866463357CF51C016241820", 0x014c);
        AssertNative(package, $"lib/{TargetFramework}/x86/leptonica-1.82.0.dll", 3_379_712, "1700330110ADA8E4F07FB063915E60E2B585AD87D9B1948093945E4645B66D08", 0x014c);
    }

    [Fact]
    public void Package_ContainsExpectedSkiaAndPdfiumNativeAssetsForUiPathExecutor()
    {
        using var package = OpenPackage();

        AssertNative(package, $"lib/{TargetFramework}/libSkiaSharp.dll", 11_628_896, "7DEC3BA900AB353491E6446F0083739924C6F8DD668832E2F09D38EBFFDBBE1C", 0x8664);
        AssertNative(package, $"lib/{TargetFramework}/pdfium.dll", 5_802_496, "15DF9DDDD81EDDC5A177946AA5E34CDA821EBC46A51440ECB607F91E99644895", 0x8664);

        AssertNative(package, $"lib/{TargetFramework}/runtimes/win-x64/native/libSkiaSharp.dll", 11_628_896, "7DEC3BA900AB353491E6446F0083739924C6F8DD668832E2F09D38EBFFDBBE1C", 0x8664);
        AssertNative(package, $"lib/{TargetFramework}/runtimes/win-x64/native/pdfium.dll", 5_802_496, "15DF9DDDD81EDDC5A177946AA5E34CDA821EBC46A51440ECB607F91E99644895", 0x8664);
        AssertNative(package, $"lib/{TargetFramework}/runtimes/win-x86/native/libSkiaSharp.dll", 10_124_128, "2E49B47FF56A0F6CCF61932D33E01E9046C319DA35BBB16F9EC9572A9DCF675F", 0x014c);
        AssertNative(package, $"lib/{TargetFramework}/runtimes/win-x86/native/pdfium.dll", 5_376_512, "83BD789C4924DEB42DB18AB42F7479BE8D0D13E8CF5363C914E53404382BAA6D", 0x014c);
    }

    [Fact]
    public void Package_ExcludesScaffoldAndDevelopmentArtifacts()
    {
        using var package = OpenPackage();
        var names = package.Entries.Select(entry => entry.FullName).ToArray();

        Assert.DoesNotContain(names, name => name.EndsWith("Company.UiPath.DocumentOcr.Activities.Packaging.dll", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains(".Tests", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("Fixtures/", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.EndsWith(".cs", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.EndsWith(".pdb", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("/bin/", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(names, name => name.Contains("/obj/", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Package_TextEntriesDoNotContainDeveloperAbsolutePaths()
    {
        using var package = OpenPackage();
        var absolutePathPattern = new Regex(@"[A-Za-z]:\\|/home/|/Users/", RegexOptions.CultureInvariant);

        foreach (var entry in package.Entries.Where(IsTextEntry))
        {
            using var stream = entry.Open();
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            Assert.DoesNotMatch(absolutePathPattern, reader.ReadToEnd());
        }
    }

    [Fact]
    public void Package_PreservesEmbeddedActivityMetadataResourcesViewModelAndIcon()
    {
        using var package = OpenPackage();
        using var activityStream = OpenEntry(package, $"lib/{TargetFramework}/Company.UiPath.DocumentOcr.Activities.dll");
        using var memory = new MemoryStream();
        activityStream.CopyTo(memory);
        var assembly = Assembly.Load(memory.ToArray());

        Assert.Contains("Company.UiPath.DocumentOcr.Activities.Resources.ActivitiesMetadata.json", assembly.GetManifestResourceNames());
        Assert.Contains("Company.UiPath.DocumentOcr.Activities.Resources.Resources.resources", assembly.GetManifestResourceNames());
        Assert.Contains("Company.UiPath.DocumentOcr.Activities.Resources.Icons.document-ocr.svg", assembly.GetManifestResourceNames());

        var resourceType = assembly.GetType("Company.UiPath.DocumentOcr.Activities.Resources.Resources");
        Assert.NotNull(resourceType);
        Assert.True(resourceType!.IsPublic);
        Assert.NotNull(resourceType.GetProperty("ExtractTextFromDocument_FilePath_DisplayName", BindingFlags.Public | BindingFlags.Static));

        using var metadataStream = assembly.GetManifestResourceStream("Company.UiPath.DocumentOcr.Activities.Resources.ActivitiesMetadata.json")
            ?? throw new InvalidOperationException("ActivitiesMetadata.json resource was not found.");
        using var metadata = JsonDocument.Parse(metadataStream);
        Assert.Equal(new[] { "resourceManagerName", "activities" }, metadata.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.False(metadata.RootElement.TryGetProperty("icons", out _));
        var activity = metadata.RootElement.GetProperty("activities")[0];

        Assert.Equal(
            new[] { "fullName", "shortName", "displayNameKey", "descriptionKey", "categoryKey", "viewModelType", "iconKey" },
            activity.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal("Company.UiPath.DocumentOcr.Activities.ExtractTextFromDocument", activity.GetProperty("fullName").GetString());
        Assert.Equal("DocumentOcr_Category", activity.GetProperty("categoryKey").GetString());
        Assert.Equal("Company.UiPath.DocumentOcr.Activities.ViewModels.ExtractTextFromDocumentViewModel", activity.GetProperty("viewModelType").GetString());
        Assert.Equal("document-ocr.svg", activity.GetProperty("iconKey").GetString());
        Assert.False(activity.TryGetProperty("properties", out _));

        using var iconStream = assembly.GetManifestResourceStream("Company.UiPath.DocumentOcr.Activities.Resources.Icons.document-ocr.svg")
            ?? throw new InvalidOperationException("SVG icon resource was not found.");
        using var reader = new StreamReader(iconStream);
        Assert.Contains("<svg", reader.ReadToEnd(), StringComparison.Ordinal);
    }

    private static string PackagePath
    {
        get
        {
            var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
            return Path.Combine(root, "artifacts", "packages", PackageFileName);
        }
    }

    private static ZipArchive OpenPackage()
    {
        Assert.True(File.Exists(PackagePath), $"Package was not found at '{PackagePath}'. Build the packaging project in Release before running Phase 7 package tests.");
        return ZipFile.OpenRead(PackagePath);
    }

    private static ZipArchiveEntry AssertEntry(ZipArchive package, string path)
    {
        var entry = package.GetEntry(path);
        Assert.NotNull(entry);
        return entry!;
    }

    private static Stream OpenEntry(ZipArchive package, string path)
    {
        return AssertEntry(package, path).Open();
    }

    private static XElement Metadata(XDocument nuspec)
    {
        return nuspec.Descendants().Single(element => element.Name.LocalName == "metadata");
    }

    private static string ElementValue(XElement parent, string localName)
    {
        return parent.Elements().Single(element => element.Name.LocalName == localName).Value;
    }

    private static void AssertNative(ZipArchive package, string path, long length, string hash, ushort machine)
    {
        var entry = AssertEntry(package, path);

        Assert.Equal(length, entry.Length);
        Assert.Equal(hash, Sha256(entry));
        Assert.Equal(machine, PeMachine(entry));
    }

    private static string Sha256(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var sha256 = SHA256.Create();
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return Convert.ToHexString(sha256.ComputeHash(memory.ToArray()));
    }

    private static ushort PeMachine(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        memory.Position = 0;
        using var reader = new BinaryReader(memory, Encoding.UTF8, leaveOpen: false);

        memory.Position = 0x3c;
        var peHeaderOffset = reader.ReadInt32();
        memory.Position = peHeaderOffset + 4;
        return reader.ReadUInt16();
    }

    private static bool IsTextEntry(ZipArchiveEntry entry)
    {
        var extension = Path.GetExtension(entry.FullName);
        return extension.Equals(".nuspec", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".md", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".json", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".xml", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".txt", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".ps1", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".targets", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".props", StringComparison.OrdinalIgnoreCase);
    }
}
