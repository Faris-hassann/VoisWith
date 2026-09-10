using System.Activities.DesignViewModels;

namespace Company.UiPath.DocumentOcr.Activities.ViewModels;

/// <summary>
/// Studio design-time ViewModel for <c>ExtractTextFromDocument</c>.
/// </summary>
public sealed class ExtractTextFromDocumentViewModel : DesignPropertiesViewModel
{
    /// <summary>
    /// Initializes a new instance of the <see cref="ExtractTextFromDocumentViewModel"/> class.
    /// </summary>
    /// <param name="services">The UiPath design services.</param>
    public ExtractTextFromDocumentViewModel(IDesignServices services)
        : base(services)
    {
    }

    /// <summary>
    /// Gets or sets the document path design argument.
    /// </summary>
    public DesignInArgument<string> FilePath { get; set; } = null!;

    /// <summary>
    /// Gets or sets the OCR language design argument.
    /// </summary>
    public DesignInArgument<string> Language { get; set; } = null!;

    /// <summary>
    /// Gets or sets the PDF scale design argument.
    /// </summary>
    public DesignInArgument<int> PdfScale { get; set; } = null!;

    /// <summary>
    /// Gets or sets the maximum pages design argument.
    /// </summary>
    public DesignInArgument<int> MaximumPages { get; set; } = null!;

    /// <summary>
    /// Gets or sets the maximum file size design argument.
    /// </summary>
    public DesignInArgument<int> MaximumFileSizeMb { get; set; } = null!;

    /// <summary>
    /// Gets or sets the preprocessing design argument.
    /// </summary>
    public DesignInArgument<bool> EnablePreprocessing { get; set; } = null!;

    /// <summary>
    /// Gets or sets the extracted text design argument.
    /// </summary>
    public DesignOutArgument<string> ExtractedText { get; set; } = null!;

    /// <summary>
    /// Gets or sets the page count design argument.
    /// </summary>
    public DesignOutArgument<int> PageCount { get; set; } = null!;

    /// <summary>
    /// Gets or sets the confidence design argument.
    /// </summary>
    public DesignOutArgument<double> Confidence { get; set; } = null!;

    /// <inheritdoc />
    protected override void InitializeModel()
    {
        base.InitializeModel();
    }
}
