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

def generate_questions(resume_analysis, role, difficulty="medium"):

    prompt = f"""
You are an AI technical interviewer.

Generate 10 interview questions for the candidate.

Interview Role:
{role}

Difficulty:
{difficulty}

Candidate Resume Information:
{json.dumps(resume_analysis, indent=2)}

Requirements:

1. Questions must be relevant to the selected job role.
2. Questions should use the candidate's skills and projects.
3. Include questions about projects from the resume.
4. Include technical questions.
5. Do not ask questions unrelated to the candidate.
6. Mix conceptual and practical questions.
7. Return ONLY valid JSON.

Return exactly 10 question objects.

Every question object must contain:
- id
- question
- topic
- difficulty

The IDs must be numbered from 1 to 10.
Return ONLY valid JSON in this format:
{{
    "questions": [
        {{
            "id": 1,
            "question": "Question here",
            "topic": "Python",
            "difficulty": "medium"
        }}
    ]
}}
"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {
                "role": "system",
                "content": "You are a professional resume analysis assistant. Always return valid JSON only."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.5,
        response_format={
            "type": "json_object"
        }
    )

    result = response.choices[0].message.content
    

    return json.loads(result)