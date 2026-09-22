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


def analyze_resume(resume_text):

    prompt = f"""
Analyze the following resume.

Return ONLY valid JSON.
Do not use markdown.
Do not use ```json.
Do not add any explanation outside the JSON.

Use exactly this structure:

{{
    "skills": [],
    "education": [],
    "projects": [],
    "experience": [],
    "technologies": []
}}

Resume:
{resume_text}
"""

    try:

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
            temperature=0,
            response_format={
                "type": "json_object"
            }
        )

        result = response.choices[0].message.content

        with open("llm.txt",'+w') as f:
            f.write(result)



        print("AI RAW RESPONSE:")
        print(result)

        if not result:
            raise ValueError("AI returned an empty response")

        analysis = json.loads(result)

        return analysis

    except Exception as e:

        print("ERROR IN RESUME ANALYSIS:")
        print(str(e))

        raise