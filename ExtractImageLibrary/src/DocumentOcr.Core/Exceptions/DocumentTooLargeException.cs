namespace DocumentOcr.Core.Exceptions;

/// <summary>
/// The exception that is thrown when a document exceeds the configured maximum file size.
/// </summary>
public sealed class DocumentTooLargeException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="DocumentTooLargeException"/> class.
    /// </summary>
    /// <param name="documentPath">The document path.</param>
    /// <param name="actualBytes">The actual file size in bytes.</param>
    /// <param name="maximumBytes">The maximum allowed file size in bytes.</param>
    public DocumentTooLargeException(string documentPath, long actualBytes, long maximumBytes)
        : base($"The document at '{documentPath}' is {actualBytes} bytes, which exceeds the maximum allowed size of {maximumBytes} bytes.")
    {
        ArgumentNullException.ThrowIfNull(documentPath);

        if (actualBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(actualBytes), actualBytes, "Actual bytes cannot be negative.");
        }

        if (maximumBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumBytes), maximumBytes, "Maximum bytes cannot be negative.");
        }

        DocumentPath = documentPath;
        ActualBytes = actualBytes;
        MaximumBytes = maximumBytes;
    }

    /// <summary>
    /// Gets the document path.
    /// </summary>
    public string DocumentPath { get; }

    /// <summary>
    /// Gets the actual file size in bytes.
    /// </summary>
    public long ActualBytes { get; }

    /// <summary>
    /// Gets the maximum allowed file size in bytes.
    /// </summary>
    public long MaximumBytes { get; }
}
