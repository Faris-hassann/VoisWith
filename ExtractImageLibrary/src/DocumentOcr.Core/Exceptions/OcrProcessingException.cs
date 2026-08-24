namespace DocumentOcr.Core.Exceptions;

/// <summary>
/// The exception that is thrown when OCR processing fails.
/// </summary>
public sealed class OcrProcessingException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="OcrProcessingException"/> class.
    /// </summary>
    /// <param name="message">The exception message.</param>
    public OcrProcessingException(string message)
        : base(message)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="OcrProcessingException"/> class.
    /// </summary>
    /// <param name="message">The exception message.</param>
    /// <param name="innerException">The inner exception.</param>
    public OcrProcessingException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
