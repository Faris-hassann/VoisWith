using System.Activities;
using System.Activities.Validation;
using DocumentOcr.Core.Models;
using DocumentOcr.Core.Services;
using DocumentOcr.Infrastructure.Imaging;
using DocumentOcr.Infrastructure.Ocr;
using DocumentOcr.Infrastructure.Pdf;

namespace Company.UiPath.DocumentOcr.Activities;

/// <summary>
/// UiPath activity that extracts OCR text from a PDF or image document.
/// </summary>
public sealed class ExtractTextFromDocument : AsyncTaskCodeActivity
{
    private readonly Func<string?, OcrOptions, CancellationToken, Task<OcrResult>> _extractAsync;

    /// <summary>
    /// Initializes a new instance of the <see cref="ExtractTextFromDocument"/> class.
    /// </summary>
    public ExtractTextFromDocument()
        : this(ExtractWithRealPipelineAsync)
    {
    }

    internal ExtractTextFromDocument(Func<string?, OcrOptions, CancellationToken, Task<OcrResult>> extractAsync)
    {
        _extractAsync = extractAsync ?? throw new ArgumentNullException(nameof(extractAsync));
        Language = new InArgument<string>("eng");
        PdfScale = new InArgument<int>(3);
        MaximumPages = new InArgument<int>(50);
        MaximumFileSizeMb = new InArgument<int>(50);
        EnablePreprocessing = new InArgument<bool>(true);
    }

    /// <summary>
    /// Gets or sets the PDF or image file path to process.
    /// </summary>
    [RequiredArgument]
    public InArgument<string> FilePath { get; set; } = null!;

    /// <summary>
    /// Gets or sets the Tesseract language code or plus-separated language expression.
    /// </summary>
    public InArgument<string> Language { get; set; }

    /// <summary>
    /// Gets or sets the PDF rendering scale factor.
    /// </summary>
    public InArgument<int> PdfScale { get; set; }

    /// <summary>
    /// Gets or sets the maximum number of PDF pages allowed.
    /// </summary>
    public InArgument<int> MaximumPages { get; set; }

    /// <summary>
    /// Gets or sets the maximum allowed file size in mebibytes.
    /// </summary>
    public InArgument<int> MaximumFileSizeMb { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether image preprocessing is enabled.
    /// </summary>
    public InArgument<bool> EnablePreprocessing { get; set; }

    /// <summary>
    /// Gets or sets the aggregated OCR text output.
    /// </summary>
    public OutArgument<string> ExtractedText { get; set; } = null!;

    /// <summary>
    /// Gets or sets the number of processed pages output.
    /// </summary>
    public OutArgument<int> PageCount { get; set; } = null!;

    /// <summary>
    /// Gets or sets the average OCR confidence output.
    /// </summary>
    public OutArgument<double> Confidence { get; set; } = null!;

    /// <inheritdoc />
    protected override async Task ExecuteAsync(AsyncCodeActivityContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);

        var extractedText = ExtractedText.GetLocation(context);
        var pageCount = PageCount.GetLocation(context);
        var confidence = Confidence.GetLocation(context);
        var options = new OcrOptions(
            SplitLanguages(Language.Get(context)),
            PdfScale.Get(context),
            MaximumPages.Get(context),
            MaximumFileSizeMb.Get(context),
            enableAutoRotate: true,
            EnablePreprocessing.Get(context));

        var result = await _extractAsync(FilePath.Get(context), options, cancellationToken).ConfigureAwait(false);

        extractedText.Value = result.Text;
        pageCount.Value = result.PageCount;
        confidence.Value = result.AverageConfidence;
    }

    private static async Task<OcrResult> ExtractWithRealPipelineAsync(
        string? filePath,
        OcrOptions options,
        CancellationToken cancellationToken)
    {
        using var ocrEngine = new TesseractOcrEngine();
        var service = new DocumentOcrService(new PdfPageRenderer(), new ImagePreprocessor(), ocrEngine);
        return await service.ExtractAsync(filePath, options, cancellationToken).ConfigureAwait(false);
    }

    private static IEnumerable<string> SplitLanguages(string? language)
    {
        if (language is null)
        {
            return new[] { "eng" };
        }

        return language
            .Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
