namespace DocumentOcr.Core.Models;

/// <summary>
/// Represents OCR output for a single page.
/// </summary>
public sealed class OcrPageResult
{
    /// <summary>
    /// Initializes a new instance of the <see cref="OcrPageResult"/> class.
    /// </summary>
    /// <param name="pageNumber">The one-based page number.</param>
    /// <param name="text">The recognized page text.</param>
    /// <param name="confidence">The OCR confidence score in the inclusive range 0 to 100.</param>
    public OcrPageResult(int pageNumber, string text, double confidence)
    {
        if (pageNumber <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(pageNumber), pageNumber, "Page number must be greater than zero.");
        }

        ArgumentNullException.ThrowIfNull(text);

        if (double.IsNaN(confidence) || double.IsInfinity(confidence) || confidence < 0 || confidence > 100)
        {
            throw new ArgumentOutOfRangeException(nameof(confidence), confidence, "Confidence must be a finite value between 0 and 100.");
        }

        PageNumber = pageNumber;
        Text = text;
        Confidence = confidence;
    }

    /// <summary>
    /// Gets the one-based page number.
    /// </summary>
    public int PageNumber { get; }

    /// <summary>
    /// Gets the recognized page text.
    /// </summary>
    public string Text { get; }

    /// <summary>
    /// Gets the OCR confidence score in the inclusive range 0 to 100.
    /// </summary>
    public double Confidence { get; }
}
