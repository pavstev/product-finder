/** Review field limits in code points after trimming. The database varchar limits match. The title is optional. */
export const REVIEW_LIMITS = {
  rating: { min: 1, max: 5 },
  title: { min: 1, max: 120 },
  body: { min: 10, max: 2000 },
  authorName: { min: 2, max: 60 },
} as const;
