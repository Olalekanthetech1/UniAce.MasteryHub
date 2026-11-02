export const classifySubject = (text: string, department?: string): string | null => {
  const lowerText = text.toLowerCase();

  // Use department if available for high-confidence classification
  if (department) {
    if (department === 'Chemistry' || department === 'Chemical Engineering') return 'Chemistry';
    if (department === 'Mathematics' || department === 'Statistics') return 'Math';
    if (department === 'Physics') return 'Physics';
  }

  // Chemistry keywords
  if (
    lowerText.includes('atom') ||
    lowerText.includes('molecule') ||
    lowerText.includes('chemical') ||
    lowerText.includes('reaction') ||
    lowerText.includes('bond') ||
    lowerText.includes('element') ||
    /h2o|co2|nacl|h2so4/.test(lowerText)
  ) {
    return 'Chemistry';
  }

  // Math keywords or explicit mathematical expressions (not ordinary hyphenated English words)
  if (
    lowerText.includes('derivative') ||
    lowerText.includes('integral') ||
    lowerText.includes('equation') ||
    lowerText.includes('vector') ||
    lowerText.includes('matrix') ||
    lowerText.includes('solve') ||
    lowerText.includes('calculate') ||
    /\b\d+(?:\.\d+)?\s*[+\-*/^=]\s*\d+(?:\.\d+)?\b/.test(lowerText) ||
    /\b[a-z]\s*=\s*[-+]?\d+/i.test(lowerText) ||
    /\$[^$]+\$/.test(text)
  ) {
    return 'Math';
  }

  // Physics keywords
  if (
    lowerText.includes('force') ||
    lowerText.includes('velocity') ||
    lowerText.includes('acceleration') ||
    lowerText.includes('energy') ||
    lowerText.includes('momentum') ||
    lowerText.includes('gravity')
  ) {
    return 'Physics';
  }

  return null;
};
