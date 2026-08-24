using System.Collections.ObjectModel;

namespace DocumentOcr.Core.Exceptions;

/// <summary>
/// The exception that is thrown when a document extension is not supported.
/// </summary>
public sealed class UnsupportedDocumentException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="UnsupportedDocumentException"/> class.
    /// </summary>
    /// <param name="documentPath">The document path.</param>
    /// <param name="detectedExtension">The detected file extension, if any.</param>
    /// <param name="supportedExtensions">The supported file extensions.</param>
    public UnsupportedDocumentException(string documentPath, string? detectedExtension, IEnumerable<string> supportedExtensions)
        : base(CreateMessage(documentPath, detectedExtension, supportedExtensions))
    {
        ArgumentNullException.ThrowIfNull(documentPath);
        ArgumentNullException.ThrowIfNull(supportedExtensions);

        DocumentPath = documentPath;
        DetectedExtension = string.IsNullOrWhiteSpace(detectedExtension) ? string.Empty : detectedExtension;
        SupportedExtensions = new ReadOnlyCollection<string>(supportedExtensions.ToArray());
    }

    /// <summary>
    /// Gets the document path.
    /// </summary>
    public string DocumentPath { get; }

    /// <summary>
    /// Gets the detected file extension, or an empty string when none was present.
    /// </summary>
    public string DetectedExtension { get; }

    /// <summary>
    /// Gets the supported file extensions.
    /// </summary>
    public IReadOnlyList<string> SupportedExtensions { get; }

    private static string CreateMessage(string documentPath, string? detectedExtension, IEnumerable<string> supportedExtensions)
    {
        ArgumentNullException.ThrowIfNull(documentPath);
        ArgumentNullException.ThrowIfNull(supportedExtensions);

        var normalizedExtension = string.IsNullOrWhiteSpace(detectedExtension) ? "<none>" : detectedExtension;
        var supported = string.Join(", ", supportedExtensions);
        return $"Unsupported document type for '{documentPath}'. Detected extension: {normalizedExtension}. Supported extensions: {supported}.";
    }
}
