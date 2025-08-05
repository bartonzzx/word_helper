import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JSDOM } from "jsdom";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Create server instance
const server = new McpServer({
  name: "word_helper",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register tools
server.tool(
  "anki_add_note",
  "Add a note to Anki",
  {
    word: z.string().describe("The word to add"),
    properties: z.string().describe("Part of speech and properties of the word"),
    synonyms: z.string().describe("Synonyms of the word"),
    antonyms: z.string().describe("Antonyms of the word"),
    other_forms: z.string().describe("Other forms of the word"),
    example: z.string().describe("Example sentences using the word"),
    chinese_meaning: z.string().describe("Chinese meaning of the word"),
    deckName: z.string().describe("Anki deck name"),
    modelName: z.string().default("Word Cloze").describe("Anki model name"),
    audioUrlUk: z.string().describe("URL for UK pronunciation audio"),
    audioUrlUs: z.string().describe("URL for US pronunciation audio"),
  },
  async ({ 
    word, 
    properties, 
    synonyms, 
    antonyms, 
    other_forms, 
    example, 
    chinese_meaning, 
    deckName, 
    modelName = "Word Cloze",
    audioUrlUk,
    audioUrlUs
  }: { 
    
    word: string; 
    properties: string; 
    synonyms: string; 
    antonyms: string; 
    other_forms: string; 
    example: string; 
    chinese_meaning: string; 
    deckName: string; 
    modelName?: string;
    audioUrlUk: string;
    audioUrlUs: string;
  }) => {
    try {
      // Convert \n to <br> for proper display in Anki
      const convertNewlines = (text: string) => text.replace(/\n/g, '<br>');
      
      const ankiRequest = {
        action: "addNotes",
        version: 6,
        params: {
          notes: [
            {
              deckName: deckName,
              modelName: modelName,
              fields: {
                Word_field: `${word}[${deckName}]`,
                Word: word,
                Fieldd: deckName,
                Properties: `{{c1::${convertNewlines(properties)}}}`,
                Synonym: `{{c1::${convertNewlines(synonyms)}}}`,
                Antonym: `{{c1::${convertNewlines(antonyms)}}}`,
                Other_forms: `{{c1::${convertNewlines(other_forms)}}}`,
                Example: `{{c1::${convertNewlines(example)}}}`,
                Chinese_meaning: `{{c1::${convertNewlines(chinese_meaning)}}}`
              },
              audio: [
                {
                  url: audioUrlUk,
                  filename: `${word}_uk.mp3`,
                  fields: ["Pronunciation UK"]
                },
                {
                  url: audioUrlUs,
                  filename: `${word}_us.mp3`,
                  fields: ["Pronunciation US"]
                }
              ],
              tags: [deckName]
            }
          ]
        }
      };

      const response = await fetch("http://localhost:8765", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ankiRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add note to Anki: ${result.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully added note for "${word}" to Anki deck "${deckName}". Note ID: ${result.result?.[0] || 'unknown'}`,
          },
        ],
      };

    } catch (error) {
      console.error("Error adding note to Anki:", error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to add note to Anki for "${word}". Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
)

server.tool(
  "search_word",
  "Search word meaning in Cambridge Dictionary",
  {
    word: z.string().describe("The word to search for its meaning"),
  },
  async ({ word }: { word: string }) => {
    if (!word) {
      return {
        content: [
          {
            type: "text",
            text: "Please provide a word to search",
          },
        ],
      };
    }

    try {
      const base = 'https://dictionary.cambridge.org/dictionary/english/';
      const url = base + encodeURIComponent(word);
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      const dom = new JSDOM(html);
      const doc = dom.window.document;

      const entries = doc.querySelectorAll('.entry-body__el');
      
      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No definition found for "${word}" in Cambridge Dictionary`,
            },
          ],
        };
      }

      let result = `Definitions for "${word}":\n\n`;
      let audioUrlUk = '';
      let audioUrlUs = '';

      for (const entry of entries) {
        const headword = entry.querySelector('.headword')?.textContent?.trim() || word;
        
        // Get pronunciation
        const readings = entry.querySelectorAll('.pron .ipa');
        let pronunciation = '';
        if (readings.length > 0) {
          const ukPron = readings[0]?.textContent?.trim() || '';
          const usPron = readings[1]?.textContent?.trim() || '';
          if (ukPron || usPron) {
            pronunciation = `[UK: ${ukPron}] [US: ${usPron}]\n`;
          }
        }

        // Get audio URLs - look for audio elements with source tags
        if (!audioUrlUk) {
          // Try to find UK audio element (audio1)
          const ukAudio = entry.querySelector('#audio1') || doc.querySelector('#audio1');
          if (ukAudio) {
            const source = ukAudio.querySelector('source[type="audio/mpeg"]');
            if (source) {
              const src = source.getAttribute('src');
              if (src) {
                audioUrlUk = src.startsWith('http') ? src : 'https://dictionary.cambridge.org' + src;
                // result += `Found UK audio: ${audioUrlUk}\n`;
              }
            }
          }
        }
        
        if (!audioUrlUs) {
          // Try to find US audio element (audio2)
          const usAudio = entry.querySelector('#audio2') || doc.querySelector('#audio2');
          if (usAudio) {
            const source = usAudio.querySelector('source[type="audio/mpeg"]');
            if (source) {
              const src = source.getAttribute('src');
              if (src) {
                audioUrlUs = src.startsWith('http') ? src : 'https://dictionary.cambridge.org' + src;
                // result += `Found US audio: ${audioUrlUs}\n`;
              }
            }
          }
        }

        // Fallback: look for any audio elements and their sources
        if (!audioUrlUk || !audioUrlUs) {
          const allAudios = doc.querySelectorAll('audio');
          // result += `Total audio elements found: ${allAudios.length}\n`;
          
          allAudios.forEach((audio, index) => {
            const id = audio.getAttribute('id') || '';
            const source = audio.querySelector('source[type="audio/mpeg"]');
            const src = source ? source.getAttribute('src') : null;
            
            // result += `Audio ${index + 1}: id="${id}", src="${src}"\n`;
            
            if (src) {
              const fullSrc = src.startsWith('http') ? src : 'https://dictionary.cambridge.org' + src;
              
              // Assign based on ID or order
              if ((id === 'audio1' || index === 0) && !audioUrlUk) {
                audioUrlUk = fullSrc;
                // result += `Assigned as UK audio: ${audioUrlUk}\n`;
              } else if ((id === 'audio2' || index === 1) && !audioUrlUs) {
                audioUrlUs = fullSrc;
                // result += `Assigned as US audio: ${audioUrlUs}\n`;
              }
            }
          });
        }

        // Get part of speech
        const pos = entry.querySelector('.posgram')?.textContent?.trim();
        const partOfSpeech = pos ? `(${pos}) ` : '';

        result += `**${headword}** ${pronunciation}${partOfSpeech}\n`;

        // Get definitions - simplified approach
        const definitions = entry.querySelectorAll('.def-block, .dsense');
        let defCount = 1;

        for (const defElement of definitions) {
          // Try different selectors for definition text
          const engDef = defElement.querySelector('.def')?.textContent?.trim() ||
                        defElement.querySelector('.dsense_d')?.textContent?.trim();
          
          if (engDef) {
            result += `${defCount}. ${engDef}\n`;

            // Get examples and remove duplicates
            const examples = defElement.querySelectorAll('.examp .eg, .eg');
            const uniqueExamples = new Set<string>();
            
            examples.forEach(example => {
              const text = example.textContent?.trim();
              if (text && text.length > 0) {
                uniqueExamples.add(text);
              }
            });

            if (uniqueExamples.size > 0) {
              result += '   Examples:\n';
              const exampleArray = Array.from(uniqueExamples);
              for (let i = 0; i < Math.min(exampleArray.length, 2); i++) {
                result += `   • ${exampleArray[i]}\n`;
              }
            }
            result += '\n';
            defCount++;
          }
        }
      }

      // Add audio URLs to the result if found
      if (audioUrlUk || audioUrlUs) {
        result += '\n--- Audio URLs ---\n';
        if (audioUrlUk) {
          result += `UK pronunciation: ${audioUrlUk}\n`;
        }
        if (audioUrlUs) {
          result += `US pronunciation: ${audioUrlUs}\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: result.trim(),
          },
        ],
      };

    } catch (error) {
      console.error("Error searching Cambridge Dictionary:", error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to search Cambridge Dictionary for "${word}". Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});