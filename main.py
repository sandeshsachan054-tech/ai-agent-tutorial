import os
from dotenv import load_dotenv
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_groq import ChatGroq
from groq import Groq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_classic.agents import create_tool_calling_agent, AgentExecutor
from tools import search_tool, save_to_txt
from datetime import datetime
load_dotenv()

class ResearchResponse(BaseModel):
    topic: str
    summary: str
    sources: list[str]
    tools_used: list[str]



llm = ChatGroq(model="openai/gpt-oss-safeguard-20b", temperature=0)
parser = PydanticOutputParser(pydantic_object=ResearchResponse)

prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """
            You are a research assistant that will help generate a research paper.
            Answer the user query and use necessary tools.
            Keep your response strictly under 1000 words.
            Provide a clear, brief, and structured response based on the search context.
            Keep source URLs clean and short(root domain only).
            Use short bullet points and avoid unnecessary long explanations.
            Wrap the output in this format and provide no other text:\n{format_instructions}
            """,
        ),
        ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ]
).partial(format_instructions=parser.get_format_instructions())

tools = [search_tool, save_to_txt]
agent = create_tool_calling_agent(
    llm=llm,
    prompt=prompt,
    tools=tools
)

agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True, max_iterations=5, handle_parsing_errors=True)
def run_research(query_text: str):
    raw_response = agent_executor.invoke({"input": query_text})
    
    try:
        structured_response = parser.parse(raw_response.get("output", ""))
        result_dict = {
            "topic": structured_response.topic,
            "summary": structured_response.summary,
            "sources": structured_response.sources
        }
    except Exception:
        result_dict = {
            "topic": query_text,
            "summary": raw_response.get("output", ""),
            "sources": []
        }

    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open("research_output.txt", "a", encoding="utf-8") as f:
        f.write(f"Generated on: {current_time}\n\n")
        f.write(f"Topic: {result_dict['topic']}\n\n")
        f.write(f"Summary:\n{result_dict['summary']}\n\n")
        f.write(f"Sources: {result_dict['sources']}\n")
        f.write("\n" + "="*50 + "\n\n")

    return result_dict

if __name__ == "__main__":
    query = input("What can I help you research? ")
    res = run_research(query)
    print(res)