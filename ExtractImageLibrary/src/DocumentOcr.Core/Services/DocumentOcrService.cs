using System.Text.RegularExpressions;
using DocumentOcr.Core.Abstractions;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using DocumentOcr.Core.Validation;

namespace DocumentOcr.Core.Services;

/// <summary>
/// Coordinates document validation, optional preprocessing, OCR recognition, and result aggregation.
/// </summary>
/// <remarks>
/// <para>
/// This service owns and disposes every <see cref="DocumentPage"/> instance that it creates or receives from the
/// configured renderer and preprocessor. It never disposes the injected renderer, preprocessor, or OCR engine.
/// </para>
/// <para>
/// PDF inputs are rendered lazily and processed sequentially. Non-PDF image inputs are opened directly from disk as a
/// single page without using the renderer.
/// </para>
/// </remarks>
public sealed class DocumentOcrService
{
    private static readonly Regex TrailingWhitespaceBeforeLineFeed = new(@"[ \t]+\n", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex ExcessBlankLines = new(@"\n{3,}", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly IDocumentPageRenderer _documentPageRenderer;
    private readonly IImagePreprocessor _imagePreprocessor;
    private readonly IOcrEngine _ocrEngine;

    /// <summary>
    /// Initializes a new instance of the <see cref="DocumentOcrService"/> class.
    /// </summary>
    /// <param name="documentPageRenderer">The PDF page renderer used for PDF inputs.</param>
    /// <param name="imagePreprocessor">The image preprocessor used when preprocessing is enabled.</param>
    /// <param name="ocrEngine">The OCR engine used to recognize page text.</param>
    public DocumentOcrService(
        IDocumentPageRenderer documentPageRenderer,
        IImagePreprocessor imagePreprocessor,
        IOcrEngine ocrEngine)
    {
        _documentPageRenderer = documentPageRenderer ?? throw new ArgumentNullException(nameof(documentPageRenderer));
        _imagePreprocessor = imagePreprocessor ?? throw new ArgumentNullException(nameof(imagePreprocessor));
        _ocrEngine = ocrEngine ?? throw new ArgumentNullException(nameof(ocrEngine));
    }

    /// <summary>
    /// Extracts OCR text from a document file into an aggregated result.
    /// </summary>
    /// <param name="filePath">The document file path to process.</param>
    /// <param name="options">The optional OCR options that govern validation and processing. When omitted, default options are used.</param>
    /// <param name="cancellationToken">The token used to cancel the operation.</param>
    /// <returns>The aggregated OCR result.</returns>
    /// <exception cref="ArgumentException">Thrown when the supplied path is invalid.</exception>
    /// <exception cref="FileNotFoundException">Thrown when the validated document file is missing.</exception>
    /// <exception cref="UnsupportedDocumentException">Thrown when the file extension is unsupported.</exception>
    /// <exception cref="DocumentTooLargeException">Thrown when the file exceeds the configured size limit.</exception>
    /// <exception cref="DocumentPageLimitExceededException">Thrown when a rendered PDF exceeds the configured page limit.</exception>
    /// <exception cref="OperationCanceledException">Thrown when <paramref name="cancellationToken"/> is canceled.</exception>
    public async Task<OcrResult> ExtractAsync(string? filePath, OcrOptions? options = null, CancellationToken cancellationToken = default)
    {
        var effectiveOptions = options ?? new OcrOptions();

        cancellationToken.ThrowIfCancellationRequested();

        var documentFile = DocumentValidator.Validate(filePath, effectiveOptions);
        cancellationToken.ThrowIfCancellationRequested();
        var canonicalPath = documentFile.FullName;

        var pageResults = documentFile.Extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase)
            ? await ProcessPdfAsync(canonicalPath, effectiveOptions, cancellationToken).ConfigureAwait(false)
            : await ProcessImageAsync(canonicalPath, effectiveOptions, cancellationToken).ConfigureAwait(false);

        var orderedPageResults = pageResults
            .OrderBy(page => page.PageNumber)
            .ToArray();

        cancellationToken.ThrowIfCancellationRequested();
        var aggregatedText = string.Join(
            "\n\n",
            orderedPageResults
                .Select(page => page.Text)
                .Where(text => text.Length > 0));
        cancellationToken.ThrowIfCancellationRequested();

        return new OcrResult(aggregatedText, orderedPageResults);
    }

    private async Task<IReadOnlyList<OcrPageResult>> ProcessPdfAsync(string canonicalPath, OcrOptions options, CancellationToken cancellationToken)
    {
        var pageResults = new List<OcrPageResult>();
        var observedPageNumbers = new HashSet<int>();
        await using var pageEnumerator = _documentPageRenderer
            .RenderAsync(canonicalPath, options, cancellationToken)
            .GetAsyncEnumerator(cancellationToken);

        while (true)
        {
            bool hasNextPage;

            try
            {
                hasNextPage = await pageEnumerator.MoveNextAsync().ConfigureAwait(false);
            }
            catch (Exception exception) when (ShouldWrapRendererException(exception))
            {
                throw new OcrProcessingException($"Unable to render PDF '{canonicalPath}'.", exception);
            }

            if (!hasNextPage)
            {
                break;
            }

            var rawPage = pageEnumerator.Current;
            await using (rawPage.ConfigureAwait(false))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var pageResult = await ProcessPageCoreAsync(rawPage, canonicalPath, options, cancellationToken).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();

                if (!observedPageNumbers.Add(pageResult.PageNumber))
                {
                    throw new OcrProcessingException(
                        $"Document '{canonicalPath}' produced duplicate OCR page number {pageResult.PageNumber}.",
                        new InvalidOperationException("Duplicate page numbers are not allowed."));
                }

                pageResults.Add(pageResult);
                cancellationToken.ThrowIfCancellationRequested();
            }
        }

        return pageResults;
    }

    private async Task<IReadOnlyList<OcrPageResult>> ProcessImageAsync(string canonicalPath, OcrOptions options, CancellationToken cancellationToken)
    {
        await using var rawPage = new DocumentPage(1, OpenImageDocumentStream(canonicalPath));
        cancellationToken.ThrowIfCancellationRequested();
        var pageResult = await ProcessPageCoreAsync(rawPage, canonicalPath, options, cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        return new[] { pageResult };
    }

    private async Task<OcrPageResult> ProcessPageCoreAsync(
        DocumentPage rawPage,
        string canonicalPath,
        OcrOptions options,
        CancellationToken cancellationToken)
    {
        DocumentPage? processedPage = null;

        try
        {
            var pageForOcr = rawPage;
            cancellationToken.ThrowIfCancellationRequested();

            if (options.EnablePreprocessing)
            {
                DocumentPage candidatePage;

                try
                {
                    candidatePage = await _imagePreprocessor.ProcessAsync(rawPage, options, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception exception) when (ShouldWrapPreprocessorException(exception))
                {
                    throw new OcrProcessingException(
                        $"Unable to preprocess document page {rawPage.PageNumber}.",
                        exception);
                }

                if (ReferenceEquals(candidatePage, rawPage))
                {
                    throw new OcrProcessingException(
                        $"Unable to preprocess document page {rawPage.PageNumber}.",
                        new InvalidOperationException("The image preprocessor returned the original page instance."));
                }

                if (candidatePage.PageNumber != rawPage.PageNumber)
                {
                    await candidatePage.DisposeAsync().ConfigureAwait(false);
                    throw new OcrProcessingException(
                        $"Unable to preprocess document page {rawPage.PageNumber}.",
                        new InvalidOperationException("The image preprocessor returned a page with a mismatched page number."));
                }

                processedPage = candidatePage;
                pageForOcr = processedPage;
                cancellationToken.ThrowIfCancellationRequested();
            }

            OcrPageResult pageResult;

            try
            {
                pageResult = await _ocrEngine.RecognizeAsync(pageForOcr, options, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception exception) when (ShouldWrapOcrException(exception))
            {
                throw new OcrProcessingException(
                    $"OCR processing failed for page {pageForOcr.PageNumber}.",
                    exception);
            }

            if (pageResult.PageNumber != pageForOcr.PageNumber)
            {
                throw new OcrProcessingException(
                    $"OCR processing failed for page {pageForOcr.PageNumber}.",
                    new InvalidOperationException("The OCR engine returned a result with a mismatched page number."));
            }

            cancellationToken.ThrowIfCancellationRequested();
            return new OcrPageResult(pageResult.PageNumber, CleanPageText(pageResult.Text), pageResult.Confidence);
        }
        finally
        {
            if (processedPage is not null)
            {
                await processedPage.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    private static FileStream OpenImageDocumentStream(string canonicalPath)
    {
        try
        {
            return new FileStream(canonicalPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception exception) when (ShouldWrapImageOpenException(exception))
        {
            throw new OcrProcessingException($"Unable to open image document '{canonicalPath}'.", exception);
        }
    }

    private static string CleanPageText(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        var normalized = text
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n');

        normalized = TrailingWhitespaceBeforeLineFeed.Replace(normalized, "\n");
        normalized = ExcessBlankLines.Replace(normalized, "\n\n");

        return normalized.Trim();
    }

    private static bool ShouldWrapRendererException(Exception exception)
    {
        return exception is not OperationCanceledException
            and not OcrProcessingException
            and not DocumentPageLimitExceededException
            and not ObjectDisposedException
            && !IsFatalException(exception);
    }

    private static bool ShouldWrapPreprocessorException(Exception exception)
    {
        return exception is not OperationCanceledException
            and not OcrProcessingException
            and not DocumentPageLimitExceededException
            and not ObjectDisposedException
            && !IsFatalException(exception);
    }

    private static bool ShouldWrapOcrException(Exception exception)
    {
        return exception is not OperationCanceledException
            and not OcrProcessingException
            and not DocumentPageLimitExceededException
            and not ArgumentException
            and not ObjectDisposedException
            && !IsFatalException(exception);
    }

    private static bool ShouldWrapImageOpenException(Exception exception)
    {
        return exception is not OperationCanceledException
            and not OcrProcessingException
            and not DocumentPageLimitExceededException
            and not ObjectDisposedException
            && !IsFatalException(exception);
    }

    private static bool IsFatalException(Exception exception)
    {
        return exception is OutOfMemoryException
            or StackOverflowException
            or AccessViolationException
            or AppDomainUnloadedException
            or CannotUnloadAppDomainException;
    }
}
