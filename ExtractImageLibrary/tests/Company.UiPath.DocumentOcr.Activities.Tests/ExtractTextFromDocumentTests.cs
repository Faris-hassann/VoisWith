using System.Activities;
using System.Activities.DesignViewModels;
using System.Reflection;
using System.Resources;
using System.Text.Json;
using System.Text.RegularExpressions;
using ActivityResources = Company.UiPath.DocumentOcr.Activities.Resources.Resources;
using Company.UiPath.DocumentOcr.Activities.ViewModels;
using DocumentOcr.Core.Exceptions;
using DocumentOcr.Core.Models;
using Xunit;

namespace Company.UiPath.DocumentOcr.Activities.Tests;

public sealed class ExtractTextFromDocumentTests
{
    [Fact]
    public void PublicSurface_ExposesExpectedArguments()
    {
        var type = typeof(ExtractTextFromDocument);

        Assert.Equal(typeof(InArgument<string>), GetProperty(type, nameof(ExtractTextFromDocument.FilePath)).PropertyType);
        Assert.Equal(typeof(InArgument<string>), GetProperty(type, nameof(ExtractTextFromDocument.Language)).PropertyType);
        Assert.Equal(typeof(InArgument<int>), GetProperty(type, nameof(ExtractTextFromDocument.PdfScale)).PropertyType);
        Assert.Equal(typeof(InArgument<int>), GetProperty(type, nameof(ExtractTextFromDocument.MaximumPages)).PropertyType);
        Assert.Equal(typeof(InArgument<int>), GetProperty(type, nameof(ExtractTextFromDocument.MaximumFileSizeMb)).PropertyType);
        Assert.Equal(typeof(InArgument<bool>), GetProperty(type, nameof(ExtractTextFromDocument.EnablePreprocessing)).PropertyType);
        Assert.Equal(typeof(OutArgument<string>), GetProperty(type, nameof(ExtractTextFromDocument.ExtractedText)).PropertyType);
        Assert.Equal(typeof(OutArgument<int>), GetProperty(type, nameof(ExtractTextFromDocument.PageCount)).PropertyType);
        Assert.Equal(typeof(OutArgument<double>), GetProperty(type, nameof(ExtractTextFromDocument.Confidence)).PropertyType);
        Assert.NotNull(GetProperty(type, nameof(ExtractTextFromDocument.FilePath)).GetCustomAttribute<RequiredArgumentAttribute>());
    }

    [Fact]
    public void ViewModel_ExposesMatchingDesignProperties()
    {
        var type = typeof(ExtractTextFromDocumentViewModel);

        Assert.False(type.IsSealed);
        Assert.Equal(typeof(DesignInArgument<string>), GetProperty(type, "FilePath").PropertyType);
        Assert.Equal(typeof(DesignInArgument<string>), GetProperty(type, "Language").PropertyType);
        Assert.Equal(typeof(DesignInArgument<int>), GetProperty(type, "PdfScale").PropertyType);
        Assert.Equal(typeof(DesignInArgument<int>), GetProperty(type, "MaximumPages").PropertyType);
        Assert.Equal(typeof(DesignInArgument<int>), GetProperty(type, "MaximumFileSizeMb").PropertyType);
        Assert.Equal(typeof(DesignInArgument<bool>), GetProperty(type, "EnablePreprocessing").PropertyType);
        Assert.Equal(typeof(DesignOutArgument<string>), GetProperty(type, "ExtractedText").PropertyType);
        Assert.Equal(typeof(DesignOutArgument<int>), GetProperty(type, "PageCount").PropertyType);
        Assert.Equal(typeof(DesignOutArgument<double>), GetProperty(type, "Confidence").PropertyType);
    }

    [Fact]
    public void Metadata_RegistersActivityViewModelResourcesAndDirectSvgIconUsingSupportedSchema()
    {
        using var metadataStream = OpenManifestResource("Company.UiPath.DocumentOcr.Activities.Resources.ActivitiesMetadata.json");
        using var metadata = JsonDocument.Parse(metadataStream);
        Assert.Equal(new[] { "resourceManagerName", "activities" }, metadata.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.False(metadata.RootElement.TryGetProperty("icons", out _));

        var activity = metadata.RootElement.GetProperty("activities")[0];

        Assert.Equal("Company.UiPath.DocumentOcr.Activities.Resources.Resources", metadata.RootElement.GetProperty("resourceManagerName").GetString());
        Assert.Equal(
            new[] { "fullName", "shortName", "displayNameKey", "descriptionKey", "categoryKey", "viewModelType", "iconKey" },
            activity.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal("Company.UiPath.DocumentOcr.Activities.ExtractTextFromDocument", activity.GetProperty("fullName").GetString());
        Assert.Equal(nameof(ExtractTextFromDocument), activity.GetProperty("shortName").GetString());
        Assert.Equal("ExtractTextFromDocument_DisplayName", activity.GetProperty("displayNameKey").GetString());
        Assert.Equal("ExtractTextFromDocument_Description", activity.GetProperty("descriptionKey").GetString());
        Assert.Equal("DocumentOcr_Category", activity.GetProperty("categoryKey").GetString());
        Assert.Equal(ActivityResources.ExtractTextFromDocument_DisplayName, Resource("ExtractTextFromDocument_DisplayName"));
        Assert.Equal("Document OCR", Resource(activity.GetProperty("categoryKey").GetString()!));
        Assert.Equal("Company.UiPath.DocumentOcr.Activities.ViewModels.ExtractTextFromDocumentViewModel", activity.GetProperty("viewModelType").GetString());
        Assert.Equal("document-ocr.svg", activity.GetProperty("iconKey").GetString());
        Assert.False(activity.TryGetProperty("properties", out _));

        Assert.True(typeof(ActivityResources).IsPublic);
        Assert.Equal("Path to the PDF or image file to process.", ActivityResources.ExtractTextFromDocument_FilePath_Description);

        using var iconStream = OpenManifestResource("Company.UiPath.DocumentOcr.Activities.Resources.Icons.document-ocr.svg");
        using var reader = new StreamReader(iconStream);
        Assert.Contains("<svg", reader.ReadToEnd(), StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_InitializeModelCreatesStudioCardPropertiesWithExpectedLayout()
    {
        var viewModel = new TestableExtractTextFromDocumentViewModel();

        viewModel.InitializeForTest();

        var properties = new DesignProperty[]
        {
            viewModel.FilePath,
            viewModel.Language,
            viewModel.PdfScale,
            viewModel.MaximumPages,
            viewModel.MaximumFileSizeMb,
            viewModel.EnablePreprocessing,
            viewModel.ExtractedText,
            viewModel.PageCount,
            viewModel.Confidence,
        };

        Assert.All(properties, Assert.NotNull);
        Assert.Equal(Enumerable.Range(0, 9), properties.Select(property => property.OrderIndex));
        Assert.Equal(new[] { "FilePath", "Language", "PdfScale", "MaximumPages", "MaximumFileSizeMb", "EnablePreprocessing", "ExtractedText", "PageCount", "Confidence" }, properties.Select(property => property.Name));

        Assert.Equal(ActivityResources.ExtractTextFromDocument_FilePath_DisplayName, viewModel.FilePath.DisplayName);
        Assert.Equal(ActivityResources.ExtractTextFromDocument_FilePath_Description, viewModel.FilePath.Tooltip);
        Assert.Equal(ActivityResources.Input_Category, viewModel.FilePath.Category);
        Assert.True(viewModel.FilePath.IsRequired);
        Assert.True(viewModel.FilePath.IsPrincipal);

        Assert.Equal(ActivityResources.ExtractTextFromDocument_Language_DisplayName, viewModel.Language.DisplayName);
        Assert.Equal(ActivityResources.ExtractTextFromDocument_Language_Description, viewModel.Language.Tooltip);
        Assert.Equal(ActivityResources.Input_Category, viewModel.Language.Category);
        Assert.False(viewModel.Language.IsRequired);
        Assert.True(viewModel.Language.IsPrincipal);

        AssertAdvancedInput(viewModel.PdfScale, ActivityResources.ExtractTextFromDocument_PdfScale_DisplayName, ActivityResources.ExtractTextFromDocument_PdfScale_Description);
        AssertAdvancedInput(viewModel.MaximumPages, ActivityResources.ExtractTextFromDocument_MaximumPages_DisplayName, ActivityResources.ExtractTextFromDocument_MaximumPages_Description);
        AssertAdvancedInput(viewModel.MaximumFileSizeMb, ActivityResources.ExtractTextFromDocument_MaximumFileSizeMb_DisplayName, ActivityResources.ExtractTextFromDocument_MaximumFileSizeMb_Description);
        AssertAdvancedInput(viewModel.EnablePreprocessing, ActivityResources.ExtractTextFromDocument_EnablePreprocessing_DisplayName, ActivityResources.ExtractTextFromDocument_EnablePreprocessing_Description);

        AssertOutput(viewModel.ExtractedText, ActivityResources.ExtractTextFromDocument_ExtractedText_DisplayName, ActivityResources.ExtractTextFromDocument_ExtractedText_Description);
        AssertOutput(viewModel.PageCount, ActivityResources.ExtractTextFromDocument_PageCount_DisplayName, ActivityResources.ExtractTextFromDocument_PageCount_Description);
        AssertOutput(viewModel.Confidence, ActivityResources.ExtractTextFromDocument_Confidence_DisplayName, ActivityResources.ExtractTextFromDocument_Confidence_Description);
    }

    [Fact]
    public void WorkflowInvoker_UsesDefaultsAndMapsOutputs()
    {
        OcrOptions? capturedOptions = null;
        string? capturedPath = null;
        var activity = new ExtractTextFromDocument((filePath, options, _) =>
        {
            capturedPath = filePath;
            capturedOptions = options;
            return Task.FromResult(new OcrResult("mapped text", new[] { new OcrPageResult(1, "mapped text", 87.5) }));
        });

        var outputs = WorkflowInvoker.Invoke((Activity)activity, new Dictionary<string, object>
        {
            [nameof(ExtractTextFromDocument.FilePath)] = "invoice.png",
        });

        Assert.Equal("invoice.png", capturedPath);
        Assert.NotNull(capturedOptions);
        Assert.Equal(new[] { "eng" }, capturedOptions!.Languages);
        Assert.Equal(3, capturedOptions.PdfScale);
        Assert.Equal(50, capturedOptions.MaximumPages);
        Assert.Equal(50, capturedOptions.MaximumFileSizeMb);
        Assert.True(capturedOptions.EnableAutoRotate);
        Assert.True(capturedOptions.EnablePreprocessing);
        Assert.Equal("mapped text", outputs[nameof(ExtractTextFromDocument.ExtractedText)]);
        Assert.Equal(1, outputs[nameof(ExtractTextFromDocument.PageCount)]);
        Assert.Equal(87.5d, outputs[nameof(ExtractTextFromDocument.Confidence)]);
    }

    [Fact]
    public void WorkflowInvoker_MapsCustomOptions()
    {
        OcrOptions? capturedOptions = null;
        var activity = new ExtractTextFromDocument((_, options, _) =>
        {
            capturedOptions = options;
            return Task.FromResult(new OcrResult("ok", new[] { new OcrPageResult(1, "ok", 93) }));
        });

        WorkflowInvoker.Invoke((Activity)activity, new Dictionary<string, object>
        {
            [nameof(ExtractTextFromDocument.FilePath)] = "invoice.pdf",
            [nameof(ExtractTextFromDocument.Language)] = "eng+ara",
            [nameof(ExtractTextFromDocument.PdfScale)] = 4,
            [nameof(ExtractTextFromDocument.MaximumPages)] = 7,
            [nameof(ExtractTextFromDocument.MaximumFileSizeMb)] = 8,
            [nameof(ExtractTextFromDocument.EnablePreprocessing)] = false,
        });

        Assert.NotNull(capturedOptions);
        Assert.Equal(new[] { "eng", "ara" }, capturedOptions!.Languages);
        Assert.Equal(4, capturedOptions.PdfScale);
        Assert.Equal(7, capturedOptions.MaximumPages);
        Assert.Equal(8, capturedOptions.MaximumFileSizeMb);
        Assert.True(capturedOptions.EnableAutoRotate);
        Assert.False(capturedOptions.EnablePreprocessing);
    }

    [Fact]
    public void WorkflowInvoker_PropagatesServiceExceptionsWithoutEmptyOutputs()
    {
        var expected = new OcrProcessingException("service failed");
        var activity = new ExtractTextFromDocument((_, _, _) => throw expected);

        var actual = Assert.Throws<OcrProcessingException>(() => WorkflowInvoker.Invoke((Activity)activity, RequiredInputs()));

        Assert.Same(expected, actual);
    }

    [Fact]
    public void WorkflowInvoker_PropagatesCancellation()
    {
        var activity = new ExtractTextFromDocument((_, _, cancellationToken) => throw new OperationCanceledException(cancellationToken));

        Assert.ThrowsAny<OperationCanceledException>(() => WorkflowInvoker.Invoke((Activity)activity, RequiredInputs()));
    }

    [Fact]
    public void RealPipeline_RecognizesExistingHelloImage()
    {
        var outputs = WorkflowInvoker.Invoke((Activity)new ExtractTextFromDocument(), new Dictionary<string, object>
        {
            [nameof(ExtractTextFromDocument.FilePath)] = FixturePath("Images", "ocr-hello.png"),
        });

        Assert.Equal("HELLO OCR 123", NormalizeForAssertion((string)outputs[nameof(ExtractTextFromDocument.ExtractedText)]));
        Assert.Equal(1, outputs[nameof(ExtractTextFromDocument.PageCount)]);
        Assert.InRange((double)outputs[nameof(ExtractTextFromDocument.Confidence)], 0d, 100d);
    }

    [Fact]
    public void RealPipeline_RecognizesExistingTwoPageRasterPdf()
    {
        var outputs = WorkflowInvoker.Invoke((Activity)new ExtractTextFromDocument(), new Dictionary<string, object>
        {
            [nameof(ExtractTextFromDocument.FilePath)] = FixturePath("Pdf", "two-page-raster-ocr.pdf"),
        });

        Assert.Equal("PHASE FIVE PAGE ONE PHASE FIVE PAGE TWO", NormalizeForAssertion((string)outputs[nameof(ExtractTextFromDocument.ExtractedText)]));
        Assert.Equal(2, outputs[nameof(ExtractTextFromDocument.PageCount)]);
        Assert.InRange((double)outputs[nameof(ExtractTextFromDocument.Confidence)], 0d, 100d);
    }

    [Fact]
    public void BuildOutput_ContainsActivityCoreInfrastructureAndNativeOcrAssets()
    {
        var outputDirectory = AppContext.BaseDirectory;

        Assert.True(File.Exists(Path.Combine(outputDirectory, "Company.UiPath.DocumentOcr.Activities.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "DocumentOcr.Core.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "DocumentOcr.Infrastructure.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "Tesseract.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "libSkiaSharp.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "pdfium.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "TessData", "eng.traineddata")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "x64", "tesseract50.dll")));
        Assert.True(File.Exists(Path.Combine(outputDirectory, "x64", "leptonica-1.82.0.dll")));
    }

    private static PropertyInfo GetProperty(Type type, string name)
    {
        return type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public)
            ?? throw new InvalidOperationException($"Property '{name}' was not found on '{type.FullName}'.");
    }

    private static Stream OpenManifestResource(string name)
    {
        return typeof(ExtractTextFromDocument).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Resource '{name}' was not embedded.");
    }

    private static string Resource(string key)
    {
        var manager = new ResourceManager("Company.UiPath.DocumentOcr.Activities.Resources.Resources", typeof(ExtractTextFromDocument).Assembly);
        return manager.GetString(key) ?? throw new InvalidOperationException($"Resource key '{key}' was not found.");
    }

    private static void AssertAdvancedInput(DesignProperty property, string displayName, string tooltip)
    {
        Assert.Equal(displayName, property.DisplayName);
        Assert.Equal(tooltip, property.Tooltip);
        Assert.Equal(ActivityResources.Advanced_Category, property.Category);
        Assert.False(property.IsPrincipal);
        Assert.False(property.IsRequired);
    }

    private static void AssertOutput(DesignProperty property, string displayName, string tooltip)
    {
        Assert.Equal(displayName, property.DisplayName);
        Assert.Equal(tooltip, property.Tooltip);
        Assert.Equal(ActivityResources.Output_Category, property.Category);
        Assert.False(property.IsPrincipal);
        Assert.False(property.IsRequired);
    }

    private static Dictionary<string, object> RequiredInputs()
    {
        return new Dictionary<string, object>
        {
            [nameof(ExtractTextFromDocument.FilePath)] = "invoice.png",
        };
    }

    private static string FixturePath(string fixtureType, string fileName)
    {
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "Fixtures", fixtureType, fileName));
    }

    private static string NormalizeForAssertion(string value)
    {
        return Regex.Replace(value.ToUpperInvariant(), @"\s+", " ").Trim();
    }

    private sealed class TestableExtractTextFromDocumentViewModel : ExtractTextFromDocumentViewModel
    {
        public TestableExtractTextFromDocumentViewModel()
            : base(null!)
        {
            FilePath = CreateInput<string>(nameof(ExtractTextFromDocument.FilePath));
            Language = CreateInput<string>(nameof(ExtractTextFromDocument.Language));
            PdfScale = CreateInput<int>(nameof(ExtractTextFromDocument.PdfScale));
            MaximumPages = CreateInput<int>(nameof(ExtractTextFromDocument.MaximumPages));
            MaximumFileSizeMb = CreateInput<int>(nameof(ExtractTextFromDocument.MaximumFileSizeMb));
            EnablePreprocessing = CreateInput<bool>(nameof(ExtractTextFromDocument.EnablePreprocessing));
            ExtractedText = CreateOutput<string>(nameof(ExtractTextFromDocument.ExtractedText));
            PageCount = CreateOutput<int>(nameof(ExtractTextFromDocument.PageCount));
            Confidence = CreateOutput<double>(nameof(ExtractTextFromDocument.Confidence));
        }

        public void InitializeForTest()
        {
            InitializeModel();
        }

        private static DesignInArgument<T> CreateInput<T>(string name)
        {
            return new DesignInArgument<T>
            {
                Name = name,
                ActivityPropertyName = name,
            };
        }

        private static DesignOutArgument<T> CreateOutput<T>(string name)
        {
            return new DesignOutArgument<T>
            {
                Name = name,
                ActivityPropertyName = name,
            };
        }
    }
}
