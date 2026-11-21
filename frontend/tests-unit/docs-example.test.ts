import { describe, expect, it } from 'vitest';
import example from '../../docker-compose.example.yml?raw';
import doc from '../../docs/CONFIGURATION.md?raw';

// docker-compose.example.yml is the one example and the settings reference.
// docs/CONFIGURATION.md shows it in full, so the two must not drift: edit
// the yml, then paste it into the doc's yaml block.
describe('the one compose example', () => {
  it('is shown verbatim in docs/CONFIGURATION.md', () => {
    const block = /```yaml\n([\s\S]*?)\n```/.exec(doc);
    expect(block).not.toBeNull();
    expect(block![1]).toBe(example.trimEnd());
  });
});
