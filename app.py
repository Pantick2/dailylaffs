import os
from flask import Flask, render_template, jsonify, abort
from openai import OpenAI
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

app = Flask(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MAKE_WEBHOOK_URL = os.getenv("MAKE_WEBHOOK_URL")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

client = OpenAI(api_key=OPENAI_API_KEY)

def obtine_poveste_de_la_ai():
    # Modificat sistemul pentru a cere un text foarte scurt de 50-100 de cuvinte
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system", 
                "content": "You are a hilarious stand-up comedian. Write an extremely short, punchy, and funny story for 'Dailylaffs'. It MUST be between 50 and 100 words max. Be quick and witty. Add 2 relevant hashtags at the very end like #dailylaffs #funny."
            },
            {"role": "user", "content": "Tell me a short funny story."}
        ],
        max_tokens=150 # Limitam tokenii pentru a forta raspunsul scurt
    )
    return response.choices[0].message.content

@app.route('/')
def index():
    try:
        response = supabase.table("stories").select("*").order("created_at", desc=True).limit(1).execute()
        if response.data:
            return render_template('index.html', poveste=response.data[0]['content'], story_id=response.data[0]['id'])
    except Exception as e:
        print(f"Eroare DB: {e}")
    return render_template('index.html', poveste="Click the link from Facebook to read today's story!", story_id=0)

@app.route('/story/<int:story_id>')
def view_story(story_id):
    try:
        response = supabase.table("stories").select("*").eq("id", story_id).execute()
        if response.data:
            return render_template('index.html', poveste=response.data[0]['content'], story_id=response.data[0]['id'])
    except Exception as e:
        print(f"Eroare DB la incarcare: {e}")
    abort(404)

@app.route('/generate-and-post', methods=['POST'])
def generate_and_post():
    try:
        story = obtine_poveste_de_la_ai()
        
        db_response = supabase.table("stories").insert({"content": story}).execute()
        inserted_id = db_response.data[0]['id']
        
        # Luam prima propozitie ca momeala pentru Facebook
        linii = story.split('\n')
        teaser = linii[0] if linii else "You won't believe what happened..."
        
        link_redirectionare = f"https://dailylaffs.com{inserted_id}"
        mesaj_facebook = f"😂 {teaser}\n\nRead the full story here 👇\n{link_redirectionare}\n\n#dailylaffs #funny #comedy"

        if MAKE_WEBHOOK_URL:
            requests.post(MAKE_WEBHOOK_URL, json={"text": mesaj_facebook})

        return jsonify({"success": True, "story": story})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
