using DocumentOcr.Core.Models;

namespace DocumentOcr.Core.Tests;

public sealed class OcrOptionsTests
{
    [Fact]
    public void Constructor_UsesExpectedDefaults()
    {
        var options = new OcrOptions();

        Assert.Equal(new[] { "eng" }, options.Languages);
        Assert.Equal(3, options.PdfScale);
        Assert.Equal(50, options.MaximumPages);
        Assert.Equal(50, options.MaximumFileSizeMb);
        Assert.True(options.EnableAutoRotate);
        Assert.True(options.EnablePreprocessing);
    }

    [Fact]
    public void Constructor_TrimsAndCopiesLanguages()
    {
        var languages = new List<string> { " eng ", "ara" };

        var options = new OcrOptions(languages);

        languages[0] = "fra";
        languages.Add("deu");

        Assert.Equal(new[] { "eng", "ara" }, options.Languages);
    }

    [Fact]
    public void Constructor_RejectsEmptyLanguageCollection()
    {
        Assert.Throws<ArgumentException>(() => new OcrOptions(Array.Empty<string>()));
    }

    [Fact]
    public void Constructor_RejectsNullLanguageValue()
    {
        var languages = new string?[] { "eng", null };

        Assert.Throws<ArgumentException>(() => new OcrOptions(languages!));
    }

    [Fact]
    public void Constructor_RejectsBlankLanguageValue()
    {
        Assert.Throws<ArgumentException>(() => new OcrOptions(new[] { "eng", "   " }));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Constructor_RejectsNonPositivePdfScale(int value)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new OcrOptions(pdfScale: value));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Constructor_RejectsNonPositiveMaximumPages(int value)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new OcrOptions(maximumPages: value));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Constructor_RejectsNonPositiveMaximumFileSizeMb(int value)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new OcrOptions(maximumFileSizeMb: value));
    }
}
