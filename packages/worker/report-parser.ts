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

CRITICAL FOR agentQuotes: Do NOT extract raw agent internal thoughts or deliberation from the report. The report contains agent reasoning like "I am looking for weaknesses in X's positioning" or "The headline influences my evaluation" — these are SIMULATION INTERNALS, not usable feedback.

Instead, SYNTHESIZE 5-8 realistic buyer reactions based on what each agent DID in the simulation (their actions, sentiment, engagement level). Write each quote as if a real buyer said it out loud after seeing the headline/copy.

BAD (agent internal thoughts — NEVER use these):
- "I am looking for weaknesses in the positioning"
- "The title and supporting copy directly influence whether X makes my shortlist"
- "I will professionally evaluate the differentiation and honesty"
- "The headline addresses a real pain point"

GOOD (synthesized buyer reactions based on agent behavior):
- "'Stop guessing' hit me right where it hurts — I just lost a deal last week and had no idea why"
- "Every vendor says 'AI-powered analytics' now. This headline told me nothing I haven't heard from Chorus and Clari"
- "I shared this with my CRO because 'why deals die' is literally the question we argue about every Monday"
- "Nice headline, but the supporting copy is just a feature dump. I wanted to hear about outcomes, not capabilities"

Rules:
- NEVER copy agent deliberation text from the report — always synthesize
- Reference the ACTUAL headline words or copy phrases
- Write as first-person buyer speech, not analytical observation
- Each quote must make a DIFFERENT point — no repetition
- Mix of positive, negative, and indifferent reactions
- If the report is in Chinese, synthesize English quotes based on the agent's behavior`;

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
