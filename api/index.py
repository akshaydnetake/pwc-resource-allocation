from flask import Flask, request, jsonify
from flask_cors import CORS  # 👈 import this
import requests
import json
import numpy as np
import os

app = Flask(__name__)
CORS(app)

API_KEY = "AIzaSyDRDiplWe_cy8WHDCNE6n3nEOdCV0DB4oE"
MODEL_ID = "gemini-2.0-flash" 
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:generateContent?key={API_KEY}"

@app.route('/')
def home():
    return jsonify({"message": "Gemini REST Flask API is running 🚀"})

# ---------- Load your precomputed weights ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def load_weights(file_name="employee_weights.npz"):
    path = os.path.join(BASE_DIR, file_name)
    npz = np.load(path, allow_pickle=True)
    X = npz["X"]
    data = json.loads(npz["data_json"].item())
    category_mappings = json.loads(npz["category_mappings_json"].item())
    return X, data, category_mappings

X, data, category_mappings = load_weights()


# ---------- Helper functions ----------
def euclidean_distance(a, b):
    return np.sqrt(np.sum((a - b) ** 2))

def parse_time_to_hours(value):
    if not value: return 0
    value = value.lower().strip()
    num = float(''.join([c for c in value if c.isdigit() or c=='.']) or 0)
    if "min" in value: return num / 60
    if "hour" in value: return num
    if "day" in value: return num * 24
    if "week" in value: return num * 24 * 7
    return num

# ---------- Recommendation ----------
def recommend(filter_dict, top_n=10):
    categorical_cols = ["Tool", "Module", "Task"]
    numeric_cols = ["Time Frame", "Quality Rating"]

    filter_vec = []
    weight_mask = []  # new mask to ignore fields

    for col in categorical_cols:
        vec = np.zeros(len(category_mappings[col]["unique_vals"]))
        if (
            col in filter_dict
            and filter_dict[col]
            not in ["None", "", None, "any", "none"]
            and filter_dict[col] in category_mappings[col]["encoding"]
        ):
            vec = np.array(category_mappings[col]["encoding"][filter_dict[col]])
            weight_mask.extend([1] * len(vec))
        else:
            # mark ignored fields with 0 weights
            weight_mask.extend([0] * len(vec))
        filter_vec.extend(vec)

    # numeric fields
    tf_val = parse_time_to_hours(filter_dict.get("Time Frame", "0"))
    qr_val = float(filter_dict.get("Quality Rating", 0))
    filter_vec.extend([tf_val, qr_val])
    weight_mask.extend([1 if tf_val != 0 else 0, 1 if qr_val != 0 else 0])

    filter_vec = np.array(filter_vec)
    weight_mask = np.array(weight_mask)

    # weighted distance: ignore zero-weight dimensions
    def weighted_distance(a, b, w):
        mask = w > 0
        if not np.any(mask):
            return 0  # all ignored
        return np.sqrt(np.sum(((a[mask] - b[mask]) ** 2)))

    distances = [weighted_distance(filter_vec, row, weight_mask) for row in X]
    top_indices = np.argsort(distances)[:top_n]
    return [data[i] for i in top_indices]

@app.route("/predict", methods=["POST"])
def predict():
    filter_dict = request.json
    # If filter_dict is a string (from Gemini output), parse it
    if isinstance(filter_dict, str):
        import ast
        try:
            filter_dict = ast.literal_eval(filter_dict)
        except:
            return jsonify({"error": "Invalid filter JSON"}), 400

    top_candidates = recommend(filter_dict, top_n=10)
    return jsonify({"candidates": top_candidates})


@app.route('/generate', methods=['POST'])
def generate_response():
    try:
        data_json = request.get_json()
        user_prompt = data_json.get("prompt", "").strip()
        if not user_prompt:
            return jsonify({"error": "Prompt cannot be empty"}), 400

        # --- Extract all unique Tools, Modules, and Tasks ---
        unique_tools = sorted(set(item.get("Tool", "") for item in data if item.get("Tool")))
        unique_modules = sorted(set(item.get("Module", "") for item in data if item.get("Module")))
        unique_tasks = sorted(set(item.get("Task", "") for item in data if item.get("Task")))

        # --- Build relational dictionary (Tool → Modules → Tasks) ---
        tool_to_modules_tasks = {}
        for item in data:
            tool = item.get("Tool")
            module = item.get("Module")
            task = item.get("Task")
            if not tool or not module or not task:
                continue
            if tool not in tool_to_modules_tasks:
                tool_to_modules_tasks[tool] = {}
            if module not in tool_to_modules_tasks[tool]:
                tool_to_modules_tasks[tool][module] = set()
            tool_to_modules_tasks[tool][module].add(task)

        # Convert sets to lists for readability
        for tool in tool_to_modules_tasks:
            for module in tool_to_modules_tasks[tool]:
                tool_to_modules_tasks[tool][module] = list(tool_to_modules_tasks[tool][module])

        # --- Prepare formatted strings for Gemini ---
        tools_str = ", ".join(unique_tools)
        modules_str = ", ".join(unique_modules)
        tasks_str = ", ".join(unique_tasks)
        mapping_str = json.dumps(tool_to_modules_tasks, indent=2)

        # --- Gemini Prompt ---
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": f"""
You are an AI assistant for a Resource Utilization app.

We have the following available resources:
- Tools: {tools_str}
- Modules: {modules_str}
- Tasks: {tasks_str}

Here is the relationship between them (Tool → Modules → Tasks):
{mapping_str}

Map the quality rating (if given as text) using this mapping:
    "very high": 95
    "high": 85
    "medium": 65
    "low": 50
    "bad": 35

User input: "{user_prompt}"

GOAL:
Extract structured work/resource assignment data from user input by identifying the most appropriate Tool, Module, Task, Time Frame, and Quality Rating.

SUCCESS CRITERIA:
- Identify and return only information that is clearly stated or strongly implied in the user input.
- If the user input specifies or implies only a Tool, fill only the Tool field; if Module or Task are not mentioned or cannot be inferred, return "None" for them.
- Do not invent or assume Modules or Tasks that are not clearly connected to the user input.
- If the prompt is not about work/resource assignment or evaluation, return only: INVALID_PROMPT strictly.

CONSTRAINTS:
- Output must be a *comma-separated string* enclosed in double quotes for each field.
- The output **must not contain braces, brackets, or JSON formatting of any kind.**
- Use the {mapping_str} strictly as the Tools, Tasks and Modules are interdependent
- Output **must exactly follow this structure** strictly:

"Tool": "<Tool>", "Module": "<Module>", "Task": "<Task>", "Time Frame": "<Time Frame>", "Quality Rating": "<Quality Rating>"

for example, the response will come: "Tool": "ServiceNow", "Module": "Incident Management", "Task": "Report", "Time Frame": "2 hours", "Quality Rating": 85
- Each field must be enclosed in **double quotes**.
- The field names **must appear exactly as shown**.
- The response **must contain nothing else** — no braces, no explanations, no notes, no newlines, no markdown.
- If any part cannot be inferred, the corresponding value should be `"None"` for Tool, Module, Task, and Time Frame, and `"0"` for Quality Rating.
- Do not request clarification or additional input under any circumstances.

"""
                        }
                    ]
                }
            ]
        }

        headers = {"Content-Type": "application/json"}
        response = requests.post(API_URL, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        result = response.json()

        gemini_output = "No response from model."
        if "candidates" in result and len(result["candidates"]) > 0:
            parts = result["candidates"][0].get("content", {}).get("parts", [])
            if len(parts) > 0 and "text" in parts[0]:
                gemini_output = parts[0]["text"]
                if "INVALID_PROMPT" not in gemini_output:
                    gemini_output = "{" + gemini_output + "}"

        if "INVALID_PROMPT" in gemini_output:
            return jsonify({"error": "Prompt is not relevant to resource utilization"}), 400

        return jsonify({
            "input": user_prompt,
            "output": gemini_output
        })

    except requests.exceptions.RequestException as e:
        print("Request error:", e)
        return jsonify({"error": f"Request failed: {str(e)}"}), 500

    except Exception as e:
        print("Unexpected error:", e)
        return jsonify({"error": str(e)}), 500

    
if __name__ == '__main__':
    app.run(debug=True)
