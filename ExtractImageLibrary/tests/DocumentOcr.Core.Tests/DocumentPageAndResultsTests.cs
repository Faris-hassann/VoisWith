using DocumentOcr.Core.Models;

namespace DocumentOcr.Core.Tests;

public sealed class DocumentPageAndResultsTests
{
    [Fact]
    public void DocumentPage_RequiresPositivePageNumber()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new DocumentPage(0, new MemoryStream()));
    }

    [Fact]
    public void DocumentPage_RequiresReadableStream()
    {
        Assert.Throws<ArgumentException>(() => new DocumentPage(1, new UnreadableStream()));
    }

    [Fact]
    public void DocumentPage_Dispose_DisposesOwnedStreamOnce()
    {
        var stream = new TrackingStream();
        var page = new DocumentPage(1, stream);

        page.Dispose();
        page.Dispose();

        Assert.Equal(1, stream.DisposeCount);
    }

    [Fact]
    public async Task DocumentPage_DisposeAsync_DisposesOwnedStreamOnce()
    {
        var stream = new TrackingStream();
        var page = new DocumentPage(1, stream);

        await page.DisposeAsync();
        await page.DisposeAsync();

        Assert.Equal(1, stream.DisposeAsyncCount);
        Assert.Equal(0, stream.DisposeCount);
    }

    [Fact]
    public async Task DocumentPage_MixedDisposeCalls_StillDisposeOnlyOnce()
    {
        var stream = new TrackingStream();
        var page = new DocumentPage(1, stream);

        page.Dispose();
        await page.DisposeAsync();

        Assert.Equal(1, stream.TotalDisposeCalls);
    }

    [Fact]
    public void OcrPageResult_RequiresPositivePageNumber()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new OcrPageResult(0, string.Empty, 0));
    }

    [Fact]
    public void OcrPageResult_RequiresNonNullText()
    {
        Assert.Throws<ArgumentNullException>(() => new OcrPageResult(1, null!, 0));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.NegativeInfinity)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(-0.1d)]
    [InlineData(100.1d)]
    public void OcrPageResult_RejectsInvalidConfidence(double confidence)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new OcrPageResult(1, "text", confidence));
    }

    [Fact]
    public void OcrResult_OrdersPagesAndComputesDerivedValues()
    {
        var pages = new List<OcrPageResult>
        {
            new(2, "second", 80),
            new(1, "first", 100),
        };

        var result = new OcrResult("combined", pages);

        pages.Clear();

        Assert.Equal("combined", result.Text);
        Assert.Equal(2, result.PageCount);
        Assert.Equal(90, result.AverageConfidence);
        Assert.Equal(new[] { 1, 2 }, result.Pages.Select(page => page.PageNumber).ToArray());
        Assert.Equal(new[] { "first", "second" }, result.Pages.Select(page => page.Text).ToArray());
    }

    [Fact]
    public void OcrResult_UsesZeroAverageForEmptyPageCollection()
    {
        var result = new OcrResult(string.Empty, Array.Empty<OcrPageResult>());

        Assert.Equal(0, result.PageCount);
        Assert.Equal(0, result.AverageConfidence);
        Assert.Empty(result.Pages);
    }

    private sealed class UnreadableStream : MemoryStream
    {
        public override bool CanRead => false;
    }

    private sealed class TrackingStream : MemoryStream
    {
        private bool _disposeRecorded;

        public int DisposeCount { get; private set; }

        public int DisposeAsyncCount { get; private set; }

        public int TotalDisposeCalls => DisposeCount + DisposeAsyncCount;

        protected override void Dispose(bool disposing)
        {
            if (disposing && !_disposeRecorded)
            {
                _disposeRecorded = true;
                DisposeCount++;
            }

            base.Dispose(disposing);
        }

        public override ValueTask DisposeAsync()
        {
            if (!_disposeRecorded)
            {
                _disposeRecorded = true;
                DisposeAsyncCount++;
            }

            return base.DisposeAsync();
        }
    }
}
