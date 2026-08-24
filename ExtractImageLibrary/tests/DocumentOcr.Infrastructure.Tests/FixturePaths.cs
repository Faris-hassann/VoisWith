namespace DocumentOcr.Infrastructure.Tests;

internal static class FixturePaths
{
    public static string CleanTextPng => GetImagePath("clean-text.png");

    public static string LowContrastPng => GetImagePath("low-contrast.png");

    public static string OcrHelloPng => GetImagePath("ocr-hello.png");

    public static string RotatedExifJpeg => GetImagePath("rotated-exif.jpg");

    public static string SampleBmp => GetImagePath("sample.bmp");

    public static string SampleTiff => GetImagePath("sample.tiff");

    public static string SampleWebp => GetImagePath("sample.webp");

    public static string CorruptPdf => GetPdfPath("corrupt.pdf");

    public static string MultiPagePdf => GetPdfPath("multi-page.pdf");

    public static string OnePagePdf => GetPdfPath("one-page.pdf");

    public static string TwoPageRasterOcrPdf => GetPdfPath("two-page-raster-ocr.pdf");

    public static string TruncatedPdf => GetPdfPath("truncated.pdf");

    private static string GetImagePath(string fileName) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "Images", fileName);

    private static string GetPdfPath(string fileName) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "Pdf", fileName);
}

internal sealed class TemporaryDirectory : IDisposable
{
    public TemporaryDirectory()
    {
        Path = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "DocumentOcr.Infrastructure.Tests",
            Guid.NewGuid().ToString("N"));

        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string CopyFile(string sourcePath, string? destinationFileName = null)
    {
        var destinationPath = System.IO.Path.Combine(Path, destinationFileName ?? System.IO.Path.GetFileName(sourcePath));
        File.Copy(sourcePath, destinationPath);
        return destinationPath;
    }

    public void Dispose()
    {
        if (Directory.Exists(Path))
        {
            Directory.Delete(Path, recursive: true);
        }
    }
}
