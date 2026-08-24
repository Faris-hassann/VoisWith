using DocumentOcr.Core.Models;

namespace DocumentOcr.Core.Abstractions;

/// <summary>
/// Performs OCR recognition for a single page image.
/// </summary>
public interface IOcrEngine
{
    /// <summary>
    /// Recognizes text for a single page image.
    /// </summary>
    /// <param name="documentPage">The page to recognize. The OCR engine borrows but does not dispose this page.</param>
    /// <param name="options">The OCR options to apply.</param>
    /// <param name="cancellationToken">The token used to cancel the operation.</param>
    /// <returns>The OCR result for the supplied page.</returns>
    /// <exception cref="OperationCanceledException">Thrown when <paramref name="cancellationToken"/> is canceled.</exception>
    Task<OcrPageResult> RecognizeAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken);
}
