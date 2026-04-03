import OpenAI from 'openai';
import type {
  FormInput,
  ParsedResults,
  ComparisonResult,
} from '@ab-predictor/shared';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const PARSE_SYSTEM_PROMPT = `You are a data extraction assistant. Given a MiroFish simulation report about a product launch, extract structured data. Respond ONLY with valid JSON matching the schema below. No markdown, no explanation.

CRITICAL: The report may be in Chinese. ALL output text (quotes, descriptions, narratives, reasoning) MUST be translated to English. Never include Chinese characters in the output.

IMPORTANT CONTEXT: The simulation used ~25 agents who all share the same ICP role (e.g., all are VP of Sales or whatever the target buyer is), distributed across engagement tiers: non-responders, skeptics, passive observers, mild-interest, active evaluators, and champions. They share the same job title but differ in personality and disposition. When extracting agent quotes, preserve their role as stated in the simulation — most should reflect the target ICP title. Most agents SHOULD show no engagement — this is realistic, not a failure of the simulation.

CRITICAL FOR sentimentOverTime: The action log contains a "created_at" field (round number) for each action. You MUST produce one entry per round that appears in the action log. Count the positive, neutral, and negative actions in each round by analyzing post content sentiment and action types (create_post, quote_post = engagement; do_nothing, refresh = neutral). If the simulation ran 6 rounds (0-5), output 6 entries. NEVER collapse all rounds into a single entry.

CRITICAL FOR emailEngagement: Infer how each persona would behave if they received this marketing message as a cold email (subject line = the product headline). Map simulation behavior to email behavior:
- opens: count agents who showed ANY engagement (create_post, quote_post, repost, like_post) OR expressed curiosity/interest in the report, even skeptically. An agent who pushed back still "opened the email." Only agents who EXCLUSIVELY did refresh/do_nothing across all rounds count as non-openers.
- clicks: count agents who showed STRONG engagement — created original content about the product, quoted with substantive commentary, or expressed trial/evaluation intent. This maps to clicking "Learn More" in an email. Passive engagement (like/repost only) does NOT count as a click.

Output schema (JSON):
{
  "adoptionSignals": [{ "persona": string, "intent": "strong"|"moderate"|"weak"|"none", "firstMentionRound": number, "reasoning": string }],
  "objections": [{ "category": "pricing"|"trust"|"switching_cost"|"relevance"|"competition", "description": string, "frequency": number, "severity": "blocking"|"concern"|"minor" }],
  "sentimentOverTime": [{ "round": number, "positive": number, "neutral": number, "negative": number }],
  "wordOfMouth": { "shares": number, "recommendations": number, "warnings": number },
  "dominantNarrative": string,
  "agentQuotes": [{ "agentName": string, "agentRole": string, "quote": string, "sentiment": "positive"|"negative"|"neutral" }],
  "emailEngagement": { "opens": number, "clicks": number }
}

CRITICAL FOR agentQuotes: Extract 5-8 quotes maximum. Each quote must be a SPECIFIC reaction to the actual headline/copy text, not generic meta-commentary.

BAD (too generic, no signal):
- "The headline addresses a real pain point"
- "I am looking for differentiation in the positioning"
- "The headline and supporting copy influence my evaluation"

GOOD (specific, actionable, references actual words):
- "'Stop guessing' made me think of last Monday's pipeline review where we had zero insight into why three deals died"
- "The feature list feels like every other sales tool pitch — nothing tells me why THIS is different from Chorus"
- "I'd share 'stop guessing why deals die' with my CRO — it's the exact conversation we had last quarter"
- "AI-powered analytics? I've heard that from 10 vendors. Show me the before/after, not the buzzword"

Rules:
- Reference the ACTUAL headline words or copy phrases, not abstract concepts
- Include the persona's emotional/practical reaction, not analysis of "positioning"
- Each quote must be UNIQUE — no two quotes should make the same point
- Vary sentiment: include skeptics, enthusiasts, and indifferent personas
- If the report is in Chinese, translate the quotes but keep the specificity`;

export async function parseReport(
  reportMarkdown: string,
  actionsJson: string
): Promise<ParsedResults> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: PARSE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Extract structured results from this simulation report.\n\nREPORT:\n${reportMarkdown}\n\nFULL ACTION LOG:\n${actionsJson}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM during report parsing');
  return JSON.parse(content) as ParsedResults;
}

const COMPARE_SYSTEM_PROMPT = `You are a marketing analytics assistant. Given parsed results from two A/B simulations of a product launch message, produce a structured comparison. Respond ONLY with valid JSON matching the schema below. No markdown, no explanation. ALL text MUST be in English.

IMPORTANT: Use RELATIVE framing only. Never output absolute percentages like "78% adoption rate." Use multipliers, raw counts, and comparative language ("2.3x more", "5 additional personas engaged"). The simulation predicts which message performs BETTER, not exact conversion rates.

CRITICAL: The winner must be consistent with the data. Check sentimentOverTime totals, wordOfMouth counts, adoption signal strength, objection severity, and emailEngagement. If Message B has more cumulative positive signals, B should be the winner unless other metrics strongly favor A.

IMPORTANT: Among the metrics array, include TWO email-related entries derived from each message's emailEngagement data:
1. metric: "Inferred email opens" — use the opens counts from each result's emailEngagement.
2. metric: "Inferred email clicks" — use the clicks counts from each result's emailEngagement.
Use relative language in labels ("1.6x more likely to open", "2x higher click-through").

Output schema (JSON):
{
  "winner": "A"|"B"|"tie",
  "winnerLabel": string,
  "confidence": "high"|"medium"|"low",
  "summary": string,
  "metrics": [{ "metric": string, "countA": number, "countB": number, "multiplier": number, "winner": "A"|"B"|"tie", "label": string }],
  "tierBreakdown": [{ "tier": string, "totalAgents": number, "engagedA": number, "engagedB": number }],
  "keyInsight": string,
  "recommendation": string
}`;

export async function generateComparison(
  resultsA: ParsedResults,
  resultsB: ParsedResults,
  input: FormInput
): Promise<ComparisonResult> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: COMPARE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Compare these two simulation results for "${input.productName}".

Message A: "${input.headlineA}" (${input.approachLabelA || 'Message A'})
Message B: "${input.headlineB}" (${input.approachLabelB || 'Message B'})

Results A:
${JSON.stringify(resultsA, null, 2)}

Results B:
${JSON.stringify(resultsB, null, 2)}

The simulation used 25 agents in 6 tiers:
- Non-responders: 9 agents
- Skeptics: 5 agents
- Passive observers: 4 agents
- Mild interest: 3 agents
- Active evaluators: 2 agents
- Champions: 2 agents

Produce a comparison that uses RELATIVE framing only.`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM during comparison');
  return JSON.parse(content) as ComparisonResult;
}
