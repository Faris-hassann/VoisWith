using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;

namespace DocumentOcr.Core.Validation;

/// <summary>
/// Validates document input before OCR work begins.
/// </summary>
public static class DocumentValidator
{
    private static readonly string[] SupportedExtensions =
    {
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".bmp",
        ".tif",
        ".tiff",
    };

    private static readonly HashSet<string> SupportedExtensionSet = new(SupportedExtensions, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Validates a document path and size using the supplied OCR options.
    /// </summary>
    /// <param name="filePath">The document path to validate.</param>
    /// <param name="options">The OCR options that contain validation limits.</param>
    /// <returns>A validated file info instance for the document.</returns>
    public static FileInfo Validate(string? filePath, OcrOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("A non-empty document path is required.", nameof(filePath));
        }

        var resolvedPath = Path.GetFullPath(filePath);

        if (Directory.Exists(resolvedPath))
        {
            throw new ArgumentException("The provided path must refer to a file, not a directory.", nameof(filePath));
        }

        if (!File.Exists(resolvedPath))
        {
            throw new FileNotFoundException($"The document file was not found: {resolvedPath}", resolvedPath);
        }

        var detectedExtension = Path.GetExtension(resolvedPath);

        if (!SupportedExtensionSet.Contains(detectedExtension))
        {
            throw new UnsupportedDocumentException(resolvedPath, detectedExtension, SupportedExtensions);
        }

        var documentFile = new FileInfo(resolvedPath);
        var maximumBytes = (long)options.MaximumFileSizeMb * 1024 * 1024;

        if (documentFile.Length > maximumBytes)
        {
            throw new DocumentTooLargeException(resolvedPath, documentFile.Length, maximumBytes);
        }

        return documentFile;
    }
}
