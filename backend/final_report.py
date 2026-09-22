import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("api")

if not api_key:
    raise ValueError("Groq API key not found in .env file")

client = OpenAI(
    api_key=api_key,
    base_url="https://api.groq.com/openai/v1"
)


def generate_final_report(results, role):

    prompt = f"""
You are an expert technical interview evaluator.

Analyze the candidate's complete interview performance.

Interview Role:
{role}

Interview Results:
{json.dumps(results, indent=2)}

Return ONLY valid JSON.

Use exactly this structure:

{{
    "overall_score": 0,
    "technical_score": 0,
    "communication_score": 0,
    "relevance_score": 0,
    "strengths": [],
    "weaknesses": [],
    "feedback": "",
    "improvement": ""
}}

Requirements:
Calculate these scores from all interview answers:

- overall_score: overall performance out of 10
- technical_score: technical knowledge out of 10
- communication_score: communication quality out of 10
- relevance_score: how relevant and appropriate the answers were out of 10

Return ONLY valid JSON using exactly this structure:
1. overall_score must be between 0 and 10.
2. strengths should contain the candidate's strongest areas.
3. weaknesses should contain areas that need improvement.
4. feedback should be a complete overall assessment of the interview.
5. improvement should provide practical advice for improving interview performance.
6. Consider technical knowledge, communication, relevance and correctness.
7. Evaluate the candidate based on ALL answers.
8. Do not evaluate only one question.
9. Return valid JSON only.


"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {
                "role": "system",
                "content": "You are a professional technical interview evaluator. Always return valid JSON only."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0,
        response_format={
            "type": "json_object"
        }
    )

    result = response.choices[0].message.content

    if not result:
        raise ValueError("AI returned an empty final report")

    return json.loads(result)