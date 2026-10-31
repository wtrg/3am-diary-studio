'use strict';

function screenshotError(message, code = 'SCREENSHOT_MATCH_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertScreenshotCoverage(segments, screenshots) {
  if (!screenshots || !screenshots.post) {
    throw screenshotError('Thiếu ảnh chụp post; dừng, không dùng thẻ vẽ lại.');
  }
  const commentShots = screenshots.comments || {};
  for (const segment of segments) {
    if (!commentShots[segment.comment_id]) {
      throw screenshotError(
        `Thiếu ảnh chụp thật cho bình luận ${segment.comment_id}. Dừng job; không vẽ lại thẻ giả.`,
        'SCREENSHOT_MATCH_FAILED',
      );
    }
  }
  return true;
}

module.exports = { assertScreenshotCoverage };
