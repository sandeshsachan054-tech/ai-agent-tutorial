from datetime import datetime
from langchain_core.tools import tool
from ddgs import DDGS

@tool
def search_tool(query: str) -> str:
    """Search the web for real-time information, facts, and research topics."""
    try:
        with DDGS() as d:
            results = list(d.text(query, max_results=5))
        if not results:
            return "No direct search results found."
        formatted_results = "\n".join([f"- {r.get('title', '')}: {r.get('body', '')}" for r in results])
        return formatted_results
    except Exception as e:
        return f"Search error: {str(e)}"
@tool
def save_to_txt(data: str, filename: str = "research_output.txt") -> str:
    """Saves research data or summaries to a text file with a timestamp."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted_text = f"--- Research Output ---\nTimestamp: {timestamp}\n\n{data}\n\n"
    
    with open(filename, "a", encoding="utf-8") as f:
        f.write(formatted_text)
        
    return f"Data successfully saved to {filename}"