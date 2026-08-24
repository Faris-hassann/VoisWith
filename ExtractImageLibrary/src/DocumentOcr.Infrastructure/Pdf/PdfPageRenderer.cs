using System.Runtime.CompilerServices;
using DocumentOcr.Core.Abstractions;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using PDFtoImage;
using SkiaSharp;

namespace DocumentOcr.Infrastructure.Pdf;

/// <summary>
/// Renders PDF documents into sequential page images.
/// </summary>
public sealed class PdfPageRenderer : IDocumentPageRenderer
{
    /// <inheritdoc />
    public async IAsyncEnumerable<DocumentPage> RenderAsync(
        string filePath,
        OcrOptions options,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("A non-empty PDF path is required.", nameof(filePath));
        }

        ArgumentNullException.ThrowIfNull(options);

        cancellationToken.ThrowIfCancellationRequested();

        var canonicalPath = Path.GetFullPath(filePath);
        var dpi = checked(72 * options.PdfScale);
        var renderOptions = CreateRenderOptions(dpi);

        using var pdfStream = OpenReadOnlyPdfStream(canonicalPath);

        int pageCount;
        try
        {
            pageCount = Conversion.GetPageCount(pdfStream, leaveOpen: true, password: null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new OcrProcessingException($"Unable to render PDF '{canonicalPath}'.", exception);
        }

        cancellationToken.ThrowIfCancellationRequested();

        if (pageCount > options.MaximumPages)
        {
            throw new DocumentPageLimitExceededException(pageCount, options.MaximumPages);
        }

        pdfStream.Position = 0;

        IEnumerator<SKBitmap>? enumerator = null;

        try
        {
            await Task.Yield();

            try
            {
                enumerator = Conversion
                    .ToImages(pdfStream, leaveOpen: true, password: null, renderOptions)
                    .GetEnumerator();
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception)
            {
                throw new OcrProcessingException($"Unable to render PDF '{canonicalPath}'.", exception);
            }

            var pageNumber = 0;

            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();

                bool hasNext;
                try
                {
                    hasNext = enumerator.MoveNext();
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    throw new OcrProcessingException(
                        $"Unable to render page {pageNumber + 1} from PDF '{canonicalPath}'.",
                        exception);
                }

                if (!hasNext)
                {
                    yield break;
                }

                pageNumber++;

                var bitmap = enumerator.Current ?? throw new OcrProcessingException(
                    $"Unable to render page {pageNumber} from PDF '{canonicalPath}'.",
                    new InvalidOperationException("The PDF renderer returned a null page image."));

                try
                {
                    await Task.Yield();
                    cancellationToken.ThrowIfCancellationRequested();

                    var imageStream = EncodeRenderedPage(bitmap, canonicalPath, pageNumber);
                    yield return new DocumentPage(pageNumber, imageStream);
                }
                finally
                {
                    bitmap.Dispose();
                }
            }
        }
        finally
        {
            enumerator?.Dispose();
        }
    }

    private static RenderOptions CreateRenderOptions(int dpi)
    {
        return new RenderOptions
        {
            Dpi = dpi,
            UseTiling = false,
            Grayscale = false,
        };
    }

    private static MemoryStream EncodeRenderedPage(SKBitmap bitmap, string canonicalPath, int pageNumber)
    {
        var imageStream = new MemoryStream();

        try
        {
            if (!bitmap.Encode(imageStream, SKEncodedImageFormat.Png, 100))
            {
                throw new InvalidOperationException("The rendered PDF page could not be encoded as PNG.");
            }

            imageStream.Position = 0;
            return imageStream;
        }
        catch (Exception exception)
        {
            imageStream.Dispose();
            throw new OcrProcessingException(
                $"Unable to render page {pageNumber} from PDF '{canonicalPath}'.",
                exception);
        }
    }

    private static FileStream OpenReadOnlyPdfStream(string canonicalPath)
    {
        try
        {
            return new FileStream(canonicalPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or DirectoryNotFoundException or FileNotFoundException or PathTooLongException or NotSupportedException)
        {
            throw new OcrProcessingException($"Unable to render PDF '{canonicalPath}'.", exception);
        }
    }
}
