using System.Collections.ObjectModel;

namespace DocumentOcr.Core.Models;

/// <summary>
/// Defines provider-neutral options for document OCR processing.
/// </summary>
public sealed class OcrOptions
{
    /// <summary>
    /// Initializes a new instance of the <see cref="OcrOptions"/> class.
    /// </summary>
    /// <param name="languages">The OCR language codes to request. When omitted, <c>eng</c> is used.</param>
    /// <param name="pdfScale">The PDF rendering scale factor.</param>
    /// <param name="maximumPages">The maximum number of pages allowed for a document.</param>
    /// <param name="maximumFileSizeMb">The maximum allowed file size in mebibytes.</param>
    /// <param name="enableAutoRotate">A value indicating whether automatic rotation should be enabled.</param>
    /// <param name="enablePreprocessing">A value indicating whether image preprocessing should be enabled.</param>
    public OcrOptions(
        IEnumerable<string>? languages = null,
        int pdfScale = 3,
        int maximumPages = 50,
        int maximumFileSizeMb = 50,
        bool enableAutoRotate = true,
        bool enablePreprocessing = true)
    {
        if (pdfScale <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(pdfScale), pdfScale, "PDF scale must be greater than zero.");
        }

        if (maximumPages <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumPages), maximumPages, "Maximum pages must be greater than zero.");
        }

        if (maximumFileSizeMb <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumFileSizeMb), maximumFileSizeMb, "Maximum file size must be greater than zero.");
        }

        Languages = new ReadOnlyCollection<string>(NormalizeLanguages(languages));
        PdfScale = pdfScale;
        MaximumPages = maximumPages;
        MaximumFileSizeMb = maximumFileSizeMb;
        EnableAutoRotate = enableAutoRotate;
        EnablePreprocessing = enablePreprocessing;
    }

    /// <summary>
    /// Gets the OCR language codes to request.
    /// </summary>
    public IReadOnlyList<string> Languages { get; }

    /// <summary>
    /// Gets the PDF rendering scale factor.
    /// </summary>
    public int PdfScale { get; }

    /// <summary>
    /// Gets the maximum number of pages allowed for a document.
    /// </summary>
    public int MaximumPages { get; }

    /// <summary>
    /// Gets the maximum allowed file size in mebibytes.
    /// </summary>
    public int MaximumFileSizeMb { get; }

    /// <summary>
    /// Gets a value indicating whether automatic rotation should be enabled.
    /// </summary>
    public bool EnableAutoRotate { get; }

    /// <summary>
    /// Gets a value indicating whether image preprocessing should be enabled.
    /// </summary>
    public bool EnablePreprocessing { get; }

    private static string[] NormalizeLanguages(IEnumerable<string>? languages)
    {
        if (languages is null)
        {
            return new[] { "eng" };
        }

        var normalizedLanguages = new List<string>();

        foreach (var language in languages)
        {
            if (language is null)
            {
                throw new ArgumentException("Language values cannot be null.", nameof(languages));
            }

            var trimmedLanguage = language.Trim();

            if (trimmedLanguage.Length == 0)
            {
                throw new ArgumentException("Language values cannot be empty or whitespace.", nameof(languages));
            }

            normalizedLanguages.Add(trimmedLanguage);
        }

        if (normalizedLanguages.Count == 0)
        {
            throw new ArgumentException("At least one language value is required.", nameof(languages));
        }

        return normalizedLanguages.ToArray();
    }
}
