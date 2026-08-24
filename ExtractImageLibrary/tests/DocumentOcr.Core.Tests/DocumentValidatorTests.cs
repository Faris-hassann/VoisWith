using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Core.Validation;
using System.Text;

namespace DocumentOcr.Core.Tests;

public sealed class DocumentValidatorTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validate_RejectsMissingPath(string? filePath)
    {
        Assert.Throws<ArgumentException>(() => DocumentValidator.Validate(filePath, new OcrOptions()));
    }

    [Fact]
    public void Validate_RejectsDirectoryPath()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var directoryPath = Path.Combine(temporaryDirectory.Path, "folder");
        Directory.CreateDirectory(directoryPath);

        Assert.Throws<ArgumentException>(() => DocumentValidator.Validate(directoryPath, new OcrOptions()));
    }

    [Fact]
    public void Validate_RejectsMissingFile()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var filePath = Path.Combine(temporaryDirectory.Path, "missing.pdf");

        var exception = Assert.Throws<FileNotFoundException>(() => DocumentValidator.Validate(filePath, new OcrOptions()));

        Assert.Equal(Path.GetFullPath(filePath), exception.FileName);
    }

    [Theory]
    [InlineData(".pdf")]
    [InlineData(".png")]
    [InlineData(".jpg")]
    [InlineData(".jpeg")]
    [InlineData(".webp")]
    [InlineData(".bmp")]
    [InlineData(".tif")]
    [InlineData(".tiff")]
    public void Validate_AcceptsSupportedExtensions(string extension)
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var filePath = temporaryDirectory.CreateFile($"sample{extension}", MinimalContentFor(extension));

        var fileInfo = DocumentValidator.Validate(filePath, new OcrOptions());

        Assert.Equal(Path.GetFullPath(filePath), fileInfo.FullName);
    }

    [Theory]
    [InlineData(".PDF")]
    [InlineData(".JpG")]
    [InlineData(".TIFF")]
    public void Validate_AcceptsSupportedExtensionsCaseInsensitively(string extension)
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var filePath = temporaryDirectory.CreateFile($"sample{extension}", new byte[] { 0x01 });

        var fileInfo = DocumentValidator.Validate(filePath, new OcrOptions());

        Assert.Equal(Path.GetFullPath(filePath), fileInfo.FullName);
    }

    [Theory]
    [InlineData(".docx")]
    [InlineData(".txt")]
    [InlineData(".exe")]
    [InlineData("")]
    public void Validate_RejectsUnsupportedExtensions(string extension)
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var filePath = temporaryDirectory.CreateFile($"sample{extension}", new byte[] { 0x01 });

        var exception = Assert.Throws<UnsupportedDocumentException>(() => DocumentValidator.Validate(filePath, new OcrOptions()));

        Assert.Equal(Path.GetFullPath(filePath), exception.DocumentPath);
        Assert.Equal(extension, exception.DetectedExtension);
        Assert.Contains(".pdf", exception.Message);
    }

    [Fact]
    public void Validate_AcceptsFileExactlyAtSizeLimit()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var filePath = temporaryDirectory.CreateFile("limit.pdf", length: 1024L * 1024L);

        var fileInfo = DocumentValidator.Validate(filePath, new OcrOptions(maximumFileSizeMb: 1));

        Assert.Equal(1024L * 1024L, fileInfo.Length);
    }

    [Fact]
    public void Validate_RejectsFileOneByteOverSizeLimit()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var filePath = temporaryDirectory.CreateFile("over-limit.pdf", length: (1024L * 1024L) + 1L);

        var exception = Assert.Throws<DocumentTooLargeException>(() => DocumentValidator.Validate(filePath, new OcrOptions(maximumFileSizeMb: 1)));

        Assert.Equal((1024L * 1024L) + 1L, exception.ActualBytes);
        Assert.Equal(1024L * 1024L, exception.MaximumBytes);
    }

    private static byte[] MinimalContentFor(string extension) =>
        extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase)
            ? Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF")
            : extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
                ? new byte[] { 0x89, 0x50, 0x4E, 0x47 }
                : new byte[] { 0x01 };
}

internal sealed class TemporaryDirectory : IDisposable
{
    public TemporaryDirectory()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "DocumentOcr.Core.Tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string CreateFile(string relativePath, byte[]? contents = null, long? length = null)
    {
        var fullPath = System.IO.Path.Combine(Path, relativePath);
        var parentDirectory = System.IO.Path.GetDirectoryName(fullPath);

        if (!string.IsNullOrEmpty(parentDirectory))
        {
            Directory.CreateDirectory(parentDirectory);
        }

        using var stream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);

        if (contents is not null && contents.Length > 0)
        {
            stream.Write(contents, 0, contents.Length);
        }

        if (length.HasValue)
        {
            stream.SetLength(length.Value);
        }

        return fullPath;
    }

    public void Dispose()
    {
        if (Directory.Exists(Path))
        {
            Directory.Delete(Path, recursive: true);
        }
    }
}
