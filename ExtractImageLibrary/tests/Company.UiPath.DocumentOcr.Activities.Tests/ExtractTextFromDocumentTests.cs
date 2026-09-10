using System.Activities;
using System.Activities.DesignViewModels;
using System.Reflection;
using System.Resources;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    public void Metadata_RegistersActivityViewModelResourcesIconAndPropertyLayout()
    {
        using var metadataStream = OpenManifestResource("Company.UiPath.DocumentOcr.Activities.Resources.ActivitiesMetadata.json");
        using var metadata = JsonDocument.Parse(metadataStream);
        var activity = metadata.RootElement.GetProperty("activities")[0];

        Assert.Equal("Company.UiPath.DocumentOcr.Activities.Resources.Resources", metadata.RootElement.GetProperty("resourceManagerName").GetString());
        Assert.Equal("Company.UiPath.DocumentOcr.Activities.ExtractTextFromDocument", activity.GetProperty("fullName").GetString());
        Assert.Equal("Extract Text From Document", Resource("ExtractTextFromDocument_DisplayName"));
        Assert.Equal("Document OCR", Resource(activity.GetProperty("categoryKey").GetString()!));
        Assert.Equal("Company.UiPath.DocumentOcr.Activities.ViewModels.ExtractTextFromDocumentViewModel", activity.GetProperty("viewModelType").GetString());
        Assert.Equal("document-ocr", activity.GetProperty("iconKey").GetString());

        var properties = activity.GetProperty("properties").EnumerateArray().ToArray();
        Assert.Equal(
            new[] { "FilePath", "Language", "PdfScale", "MaximumPages", "MaximumFileSizeMb", "EnablePreprocessing", "ExtractedText", "PageCount", "Confidence" },
            properties.Select(property => property.GetProperty("name").GetString()).ToArray());
        Assert.Equal(new[] { true, true }, properties.Take(2).Select(property => property.GetProperty("isPrincipal").GetBoolean()).ToArray());
        Assert.All(properties.Skip(2), property => Assert.False(property.TryGetProperty("isPrincipal", out var principal) && principal.GetBoolean()));
        Assert.Equal(new[] { 10, 20, 30, 40, 50, 60, 70, 80, 90 }, properties.Select(property => property.GetProperty("order").GetInt32()).ToArray());
        Assert.All(properties, property =>
        {
            Assert.False(string.IsNullOrWhiteSpace(Resource(property.GetProperty("displayNameKey").GetString()!)));
            Assert.False(string.IsNullOrWhiteSpace(Resource(property.GetProperty("descriptionKey").GetString()!)));
        });

        using var iconStream = OpenManifestResource("Company.UiPath.DocumentOcr.Activities.Resources.Icons.document-ocr.svg");
        using var reader = new StreamReader(iconStream);
        Assert.Contains("<svg", reader.ReadToEnd(), StringComparison.Ordinal);
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
}
