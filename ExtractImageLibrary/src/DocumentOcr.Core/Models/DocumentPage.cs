using System.Threading;

namespace DocumentOcr.Core.Models;

/// <summary>
/// Represents a rendered or source document page whose image stream is owned by this instance.
/// </summary>
public sealed class DocumentPage : IDisposable, IAsyncDisposable
{
    private Stream? _imageStream;

    /// <summary>
    /// Initializes a new instance of the <see cref="DocumentPage"/> class.
    /// </summary>
    /// <param name="pageNumber">The one-based page number.</param>
    /// <param name="imageStream">The readable image stream for the page. Ownership is transferred to this instance.</param>
    public DocumentPage(int pageNumber, Stream imageStream)
    {
        if (pageNumber <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(pageNumber), pageNumber, "Page number must be greater than zero.");
        }

        ArgumentNullException.ThrowIfNull(imageStream);

        if (!imageStream.CanRead)
        {
            throw new ArgumentException("The image stream must be readable.", nameof(imageStream));
        }

        PageNumber = pageNumber;
        _imageStream = imageStream;
    }

    /// <summary>
    /// Gets the one-based page number.
    /// </summary>
    public int PageNumber { get; }

    /// <summary>
    /// Gets the owned image stream.
    /// </summary>
    /// <exception cref="ObjectDisposedException">Thrown when the page has already been disposed.</exception>
    public Stream ImageStream => _imageStream ?? throw new ObjectDisposedException(nameof(DocumentPage));

    /// <summary>
    /// Disposes the owned image stream.
    /// </summary>
    public void Dispose()
    {
        Interlocked.Exchange(ref _imageStream, null)?.Dispose();
    }

    /// <summary>
    /// Asynchronously disposes the owned image stream.
    /// </summary>
    /// <returns>A value task that completes when disposal has finished.</returns>
    public async ValueTask DisposeAsync()
    {
        var imageStream = Interlocked.Exchange(ref _imageStream, null);

        if (imageStream is null)
        {
            return;
        }

        await imageStream.DisposeAsync().ConfigureAwait(false);
    }
}
