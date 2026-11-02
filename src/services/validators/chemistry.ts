import { Validator, ValidationResult } from './types';

export class ChemistryValidator implements Validator {
  async validate(input: string, _topic: string): Promise<ValidationResult> {
    // Only flag genuine structural syntax errors such as unbalanced parentheses/brackets in chemical formulas
    const chemTokens = input.match(/\b(?:[A-Z][a-z]?\d*|\(|\)|\[|\]){2,}\b/g) || [];
    for (const token of chemTokens) {
      if (!/[()]/.test(token)) continue;
      let depth = 0;
      for (const ch of token) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth < 0) break;
      }
      if (depth !== 0) {
        return {
          isValid: false,
          message: `Unbalanced parentheses detected in chemical notation "${token}".`,
          correction: 'Ensure all polyatomic group parentheses in chemical formulas are properly closed.'
        };
      }
    }
    return { isValid: true };
  }
}
