using DocumentOcr.Core.Models;

namespace DocumentOcr.Core.Abstractions;

/// <summary>
/// Converts a document into a sequence of page images.
/// </summary>
public interface IDocumentPageRenderer
{
    /// <summary>
    /// Renders a document into one or more page images.
    /// </summary>
    /// <param name="filePath">The source document path.</param>
    /// <param name="options">The OCR options to apply during rendering.</param>
    /// <param name="cancellationToken">The token used to cancel the operation.</param>
    /// <returns>A sequence of page images whose ownership transfers to the consumer.</returns>
    /// <exception cref="OperationCanceledException">Thrown when <paramref name="cancellationToken"/> is canceled.</exception>
    IAsyncEnumerable<DocumentPage> RenderAsync(string filePath, OcrOptions options, CancellationToken cancellationToken);
}
