import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("PokéGuard IA Online");
});

app.post("/analisar", async (req, res) => {
  try {

    const { relato } = req.body;

    const prompt = `
Você é a IA Penal da PokéGuard.

Sua função é analisar ocorrências de RP Pokémon e identificar TODOS os artigos aplicáveis.

REGRAS:

- Pode aplicar múltiplos artigos.
- Analise o contexto completo.
- Não dependa apenas de palavras-chave.
- Entenda sinônimos e formas diferentes de escrita.
- Se houver fuga, aplique fuga.
- Se houver roubo em residência, aplique roubo + invasão.
- Se houver uso de Pokémon em crime, aplique Art. 58.
- Resistência à prisão só existe após derrota em fuga ou batalha.
- Se houver grupo criminoso, aplique associação criminosa.
- Retorne SOMENTE JSON.

Formato:

{
  "artigos": [
    {
      "artigo": "Art. XX",
      "crime": "Nome do Crime",
      "meses": 0,
      "multa": 0,
      "motivo": "Explicação"
    }
  ]
}

Relato:

${relato}
`;

    const resposta = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1
    });

    const resultado = resposta.choices[0].message.content;

    res.json(JSON.parse(resultado));

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao analisar ocorrência."
    });

  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor iniciado na porta " + PORT);
});
