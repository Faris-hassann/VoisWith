using System.Collections.ObjectModel;

namespace DocumentOcr.Core.Models;

/// <summary>
/// Represents the aggregated OCR output for a document.
/// </summary>
public sealed class OcrResult
{
    /// <summary>
    /// Initializes a new instance of the <see cref="OcrResult"/> class.
    /// </summary>
    /// <param name="text">The aggregated document text.</param>
    /// <param name="pages">The per-page OCR results.</param>
    public OcrResult(string text, IEnumerable<OcrPageResult> pages)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(pages);

        var orderedPages = pages
            .Select(page => page ?? throw new ArgumentException("Page results cannot contain null entries.", nameof(pages)))
            .OrderBy(page => page.PageNumber)
            .ToArray();

        Text = text;
        Pages = new ReadOnlyCollection<OcrPageResult>(orderedPages);
        PageCount = orderedPages.Length;
        AverageConfidence = orderedPages.Length == 0
            ? 0
            : orderedPages.Average(page => page.Confidence);
    }

    /// <summary>
    /// Gets the aggregated document text.
    /// </summary>
    public string Text { get; }

    /// <summary>
    /// Gets the ordered per-page OCR results.
    /// </summary>
    public IReadOnlyList<OcrPageResult> Pages { get; }

    /// <summary>
    /// Gets the number of OCR result pages.
    /// </summary>
    public int PageCount { get; }

    /// <summary>
    /// Gets the arithmetic average confidence across all pages.
    /// </summary>
    public double AverageConfidence { get; }
}
