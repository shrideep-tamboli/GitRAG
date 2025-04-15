/**
 * Converts a JSON object to Markdown format with proper heading hierarchy
 * @param json The JSON object to convert
 * @param level The current heading level (h1, h2, h3, etc.)
 * @returns A string containing the markdown representation
 */
export function convertJsonToMarkdown(json: Record<string, unknown>, level = 1): string {
  if (!json || typeof json !== 'object') {
    return String(json || '');
  }

  let markdown = '';
  
  Object.entries(json).forEach(([key, value]) => {
    // Create heading with appropriate level (#, ##, ###, etc.)
    const heading = '#'.repeat(Math.min(level, 6)); // Markdown only supports h1-h6
    
    // Convert key from camelCase/snake_case to Title Case
    const formattedKey = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase());
    
    markdown += `${heading} ${formattedKey}\n\n`;
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively handle nested objects with increased heading level
      markdown += convertJsonToMarkdown(value as Record<string, unknown>, level + 1);
    } else if (Array.isArray(value)) {
      // Handle arrays as bullet points
      if (value.length === 0) {
        markdown += "*None*\n\n";
      } else {
        value.forEach((item) => {
          if (item && typeof item === 'object') {
            markdown += convertJsonToMarkdown(item as Record<string, unknown>, level + 1);
          } else {
            markdown += `- ${item}\n`;
          }
        });
        markdown += '\n';
      }
    } else if (value === null || value === undefined) {
      // Handle null or undefined values
      markdown += "*None*\n\n";
    } else if (value === '') {
      // Handle empty strings
      markdown += "*Empty*\n\n";
    } else {
      // Handle primitive values
      markdown += `${value}\n\n`;
    }
  });
  
  return markdown;
}

/**
 * Format JSON data for code summary display
 * @param summary JSON string to be formatted
 * @returns Markdown string representation of the JSON
 */
export function formatCodeSummary(summary: string): string {
  try {
    // Try to parse as JSON if it's in JSON format
    const jsonObj = JSON.parse(summary);
    return convertJsonToMarkdown(jsonObj);
  } catch {
    // If not valid JSON, return as is
    return summary;
  }
} 