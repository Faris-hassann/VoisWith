using System.Activities.DesignViewModels;

using ActivityResources = Company.UiPath.DocumentOcr.Activities.Resources.Resources;

namespace Company.UiPath.DocumentOcr.Activities.ViewModels;

/// <summary>
/// Studio design-time ViewModel for <c>ExtractTextFromDocument</c>.
/// </summary>
public class ExtractTextFromDocumentViewModel : DesignPropertiesViewModel
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

        PersistValuesChangedDuringInit();

        FilePath.DisplayName = ActivityResources.ExtractTextFromDocument_FilePath_DisplayName;
        FilePath.Tooltip = ActivityResources.ExtractTextFromDocument_FilePath_Description;
        FilePath.Category = ActivityResources.Input_Category;
        FilePath.IsRequired = true;
        FilePath.IsPrincipal = true;
        FilePath.OrderIndex = 0;

        Language.DisplayName = ActivityResources.ExtractTextFromDocument_Language_DisplayName;
        Language.Tooltip = ActivityResources.ExtractTextFromDocument_Language_Description;
        Language.Category = ActivityResources.Input_Category;
        Language.IsPrincipal = true;
        Language.OrderIndex = 1;

        PdfScale.DisplayName = ActivityResources.ExtractTextFromDocument_PdfScale_DisplayName;
        PdfScale.Tooltip = ActivityResources.ExtractTextFromDocument_PdfScale_Description;
        PdfScale.Category = ActivityResources.Advanced_Category;
        PdfScale.OrderIndex = 2;

        MaximumPages.DisplayName = ActivityResources.ExtractTextFromDocument_MaximumPages_DisplayName;
        MaximumPages.Tooltip = ActivityResources.ExtractTextFromDocument_MaximumPages_Description;
        MaximumPages.Category = ActivityResources.Advanced_Category;
        MaximumPages.OrderIndex = 3;

        MaximumFileSizeMb.DisplayName = ActivityResources.ExtractTextFromDocument_MaximumFileSizeMb_DisplayName;
        MaximumFileSizeMb.Tooltip = ActivityResources.ExtractTextFromDocument_MaximumFileSizeMb_Description;
        MaximumFileSizeMb.Category = ActivityResources.Advanced_Category;
        MaximumFileSizeMb.OrderIndex = 4;

        EnablePreprocessing.DisplayName = ActivityResources.ExtractTextFromDocument_EnablePreprocessing_DisplayName;
        EnablePreprocessing.Tooltip = ActivityResources.ExtractTextFromDocument_EnablePreprocessing_Description;
        EnablePreprocessing.Category = ActivityResources.Advanced_Category;
        EnablePreprocessing.OrderIndex = 5;

        ExtractedText.DisplayName = ActivityResources.ExtractTextFromDocument_ExtractedText_DisplayName;
        ExtractedText.Tooltip = ActivityResources.ExtractTextFromDocument_ExtractedText_Description;
        ExtractedText.Category = ActivityResources.Output_Category;
        ExtractedText.OrderIndex = 6;

        PageCount.DisplayName = ActivityResources.ExtractTextFromDocument_PageCount_DisplayName;
        PageCount.Tooltip = ActivityResources.ExtractTextFromDocument_PageCount_Description;
        PageCount.Category = ActivityResources.Output_Category;
        PageCount.OrderIndex = 7;

        Confidence.DisplayName = ActivityResources.ExtractTextFromDocument_Confidence_DisplayName;
        Confidence.Tooltip = ActivityResources.ExtractTextFromDocument_Confidence_Description;
        Confidence.Category = ActivityResources.Output_Category;
        Confidence.OrderIndex = 8;
    }
}
