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

def evaluate_answer(question, answer, role):
    prompt = f"""
You are an AI interview evaluator.
Take it easy on the scoring.

Job Role: {role}

Interview Question:
{question}

Candidate Answer:
{answer}

Evaluate the candidate's answer.

Return ONLY valid JSON in this format:

{{
    "score": 0,
    "technical_score": 0,
    "communication_score": 0,
    "relevance_score": 0,
    "strengths": [],
    "weaknesses": [],
    "feedback": "",
    "improvement": ""
}}

Rules:
- score must be between 0 and 10
- technical_score must be between 0 and 10
- communication_score must be between 0 and 10
- relevance_score must be between 0 and 10
- strengths must contain useful points
- weaknesses must contain useful points
- feedback should briefly explain the evaluation
- improvement should tell the candidate how to improve
"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {
                "role": "system",
                "content": "You are an expert technical interviewer."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.3
    )

    result = response.choices[0].message.content

    return json.loads(result)