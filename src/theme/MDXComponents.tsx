import MDXComponents from '@theme-original/MDXComponents';
import Quiz from '@site/src/components/Quiz';

/**
 * Components registered here are available in every `.md` / `.mdx` page without
 * an explicit import, which keeps content files focused on prose.
 */
export default {
  ...MDXComponents,
  Quiz,
};
