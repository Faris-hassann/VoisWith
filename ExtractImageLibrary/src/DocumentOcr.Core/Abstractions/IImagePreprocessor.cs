using DocumentOcr.Core.Models;

namespace DocumentOcr.Core.Abstractions;

/// <summary>
/// Transforms a page image into a form that is more suitable for OCR.
/// </summary>
public interface IImagePreprocessor
{
    /// <summary>
    /// Processes a page image for OCR.
    /// </summary>
    /// <param name="documentPage">The page to process. The preprocessor borrows but does not dispose this page.</param>
    /// <param name="options">The OCR options to apply during preprocessing.</param>
    /// <param name="cancellationToken">The token used to cancel the operation.</param>
    /// <returns>A new page instance whose ownership transfers to the caller.</returns>
    /// <exception cref="OperationCanceledException">Thrown when <paramref name="cancellationToken"/> is canceled.</exception>
    Task<DocumentPage> ProcessAsync(DocumentPage documentPage, OcrOptions options, CancellationToken cancellationToken);
}
