/**
 * ABOUTME: Tests for the PRD markdown parser.
 * Covers user story description extraction with various LLM-generated formats.
 */

import { describe, test, expect } from 'bun:test';
import { parsePrdMarkdown } from './parser.js';

/**
 * Helper to build a minimal PRD markdown document with a single user story.
 * The storyBody is inserted directly after the US header line.
 */
function buildPrdWithStory(storyBody: string): string {
  return `# PRD: Test Feature

## Overview

This is a test feature.

## User Stories

### US-001: Test Story

${storyBody}
`;
}

describe('parsePrdMarkdown', () => {
  describe('extractStoryDescription - plain text format', () => {
    test('extracts plain text description', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in so that I can access my account.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account.'
      );
    });

    test('extracts multi-line plain text description', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in
so that I can access my account securely.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account securely.'
      );
    });
  });

  describe('extractStoryDescription - **Description:** prefix format', () => {
    test('strips **Description:** prefix and extracts text', () => {
      const md = buildPrdWithStory(
        `**Description:** As a user, I want to log in so that I can access my account.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account.'
      );
    });

    test('handles **Description:** with multi-line content after it', () => {
      const md = buildPrdWithStory(
        `**Description:** As a user, I want to log in
so that I can access my account.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in so that I can access my account.'
      );
    });
  });

  describe('extractStoryDescription - bold keyword format', () => {
    test('strips bold markers from **As a** / **I want** / **So that** format', () => {
      const md = buildPrdWithStory(
        `**As a** registered user
**I want** to log in with email and password
**So that** I can access my account

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a registered user I want to log in with email and password So that I can access my account'
      );
    });

    test('handles inline bold keywords on single line', () => {
      const md = buildPrdWithStory(
        `**As a** user, **I want** to export data **so that** I can share it.

**Acceptance Criteria:**
- [ ] Export button works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to export data so that I can share it.'
      );
    });
  });

  describe('extractStoryDescription - stop conditions', () => {
    test('stops at **Acceptance Criteria:**', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

**Acceptance Criteria:**
- [ ] Login form works
- [ ] Error message shown`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at **Priority:**', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

**Priority:** P1

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at **Depends on:**', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

**Depends on:** US-002

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at next heading', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

### US-002: Another Story

As a user, I want to log out.`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at horizontal rule', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

---

Some other content`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('stops at empty line (end of paragraph)', () => {
      const md = buildPrdWithStory(
        `As a user, I want to log in.

Some unrelated paragraph here.`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });
  });

  describe('extractStoryDescription - does NOT stop at description-like bold', () => {
    test('does not stop at **As a** bold keyword', () => {
      const md = buildPrdWithStory(
        `**As a** user, I want to log in.

**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to log in.'
      );
    });

    test('does not stop at **Description:** label', () => {
      const md = buildPrdWithStory(
        `**Description:** Some important feature description.

**Acceptance Criteria:**
- [ ] Works correctly`
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'Some important feature description.'
      );
    });
  });

  describe('extractStoryDescription - edge cases', () => {
    test('returns title as fallback when no description found', () => {
      const md = buildPrdWithStory(
        `**Acceptance Criteria:**
- [ ] Login form works`
      );

      const result = parsePrdMarkdown(md);
      // Falls back to title when description is empty
      expect(result.userStories[0]!.description).toBe('Test Story');
    });

    test('handles description with no acceptance criteria following', () => {
      const md = buildPrdWithStory(
        'As a user, I want to do something simple.'
      );

      const result = parsePrdMarkdown(md);
      expect(result.userStories[0]!.description).toBe(
        'As a user, I want to do something simple.'
      );
    });
  });

  describe('multiple user stories with mixed formats', () => {
    test('parses multiple stories with different description formats', () => {
      const md = `# PRD: Multi-Format Feature

## Overview

Testing mixed formats.

## User Stories

### US-001: Plain Text Story

As a user, I want plain text descriptions.

**Acceptance Criteria:**
- [ ] Works

### US-002: Bold Label Story

**Description:** As a developer, I want labeled descriptions.

**Acceptance Criteria:**
- [ ] Works

### US-003: Bold Keyword Story

**As a** admin
**I want** to manage users
**So that** the system stays secure

**Acceptance Criteria:**
- [ ] Works
`;

      const result = parsePrdMarkdown(md);
      expect(result.userStories).toHaveLength(3);

      expect(result.userStories[0]!.description).toBe(
        'As a user, I want plain text descriptions.'
      );
      expect(result.userStories[1]!.description).toBe(
        'As a developer, I want labeled descriptions.'
      );
      expect(result.userStories[2]!.description).toBe(
        'As a admin I want to manage users So that the system stays secure'
      );
    });
  });
});
