namespace DocumentOcr.Core.Exceptions;

/// <summary>
/// The exception that is thrown when a document exceeds the configured page limit.
/// </summary>
public sealed class DocumentPageLimitExceededException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="DocumentPageLimitExceededException"/> class.
    /// </summary>
    /// <param name="observedPageCount">The observed page count.</param>
    /// <param name="maximumPageCount">The maximum allowed page count.</param>
    public DocumentPageLimitExceededException(int observedPageCount, int maximumPageCount)
        : base($"The document contains {observedPageCount} pages, which exceeds the maximum allowed page count of {maximumPageCount}.")
    {
        if (observedPageCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(observedPageCount), observedPageCount, "Observed page count cannot be negative.");
        }

        if (maximumPageCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumPageCount), maximumPageCount, "Maximum page count cannot be negative.");
        }

        ObservedPageCount = observedPageCount;
        MaximumPageCount = maximumPageCount;
    }

    /// <summary>
    /// Gets the observed page count.
    /// </summary>
    public int ObservedPageCount { get; }

    /// <summary>
    /// Gets the maximum allowed page count.
    /// </summary>
    public int MaximumPageCount { get; }
}
