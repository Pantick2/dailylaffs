import os
from flask import Flask, render_template, jsonify
from openai import OpenAI
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MAKE_WEBHOOK_URL = os.getenv("MAKE_WEBHOOK_URL")

client = OpenAI(api_key=OPENAI_API_KEY)

def obtine_poveste_de_la_ai():
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system", 
                "content": "You are a hilarious stand-up comedian and writer for the brand 'Dailylaffs'. Write a very short, extremely funny story (max 3 paragraphs) suitable for social media. Include 2-3 relevant hashtags at the end like #dailylaffs #funny."
            },
            {"role": "user", "content": "Tell me a new funny story."}
        ],
        max_tokens=500
    )
    return response.choices[0].message.content

@app.route('/')
def index():
    return render_template('index.html')

# Ruta 1: Doar generează o poveste nouă pe site (NU postează pe Facebook)
@app.route('/next-story', methods=['POST'])
def next_story():
    try:
        story = obtine_poveste_de_la_ai()
        return jsonify({"success": True, "story": story})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# Ruta 2: Generare automată + Postare pe Facebook (Rulată de Make sau Manual din butonul principal)
@app.route('/generate-and-post', methods=['POST'])
def generate_and_post():
    try:
        story = obtine_poveste_de_la_ai()
        if MAKE_WEBHOOK_URL:
            requests.post(MAKE_WEBHOOK_URL, json={"text": story})
        return jsonify({"success": True, "story": story})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
