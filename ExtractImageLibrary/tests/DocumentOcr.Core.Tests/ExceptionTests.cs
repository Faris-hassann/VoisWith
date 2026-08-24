using DocumentOcr.Core.Exceptions;

namespace DocumentOcr.Core.Tests;

public sealed class ExceptionTests
{
    [Fact]
    public void UnsupportedDocumentException_PreservesValuesAndMessage()
    {
        var exception = new UnsupportedDocumentException("C:\\docs\\sample.txt", ".txt", new[] { ".pdf", ".png" });

        Assert.Equal("C:\\docs\\sample.txt", exception.DocumentPath);
        Assert.Equal(".txt", exception.DetectedExtension);
        Assert.Equal(new[] { ".pdf", ".png" }, exception.SupportedExtensions);
        Assert.Contains(".txt", exception.Message);
        Assert.Contains(".pdf, .png", exception.Message);
    }

    [Fact]
    public void DocumentTooLargeException_PreservesValuesAndMessage()
    {
        var exception = new DocumentTooLargeException("C:\\docs\\large.pdf", 200, 100);

        Assert.Equal("C:\\docs\\large.pdf", exception.DocumentPath);
        Assert.Equal(200, exception.ActualBytes);
        Assert.Equal(100, exception.MaximumBytes);
        Assert.Contains("200", exception.Message);
        Assert.Contains("100", exception.Message);
    }

    [Fact]
    public void DocumentPageLimitExceededException_PreservesValuesAndMessage()
    {
        var exception = new DocumentPageLimitExceededException(51, 50);

        Assert.Equal(51, exception.ObservedPageCount);
        Assert.Equal(50, exception.MaximumPageCount);
        Assert.Contains("51", exception.Message);
        Assert.Contains("50", exception.Message);
    }

    [Fact]
    public void OcrProcessingException_PreservesInnerException()
    {
        var innerException = new InvalidOperationException("inner");
        var exception = new OcrProcessingException("outer", innerException);

        Assert.Equal("outer", exception.Message);
        Assert.Same(innerException, exception.InnerException);
    }
}
