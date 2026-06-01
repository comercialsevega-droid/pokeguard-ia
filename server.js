import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.post("/analisar", async (req, res) => {
  try {
    const { relato } = req.body;

    if (!relato || relato.trim().length < 5) {
      return res.status(400).json({
        erro: "Digite um relato maior para a IA analisar."
      });
    }

    const prompt = `
Você é a IA Penal oficial da PokéGuard, uma polícia de cidade RP Pokémon.

Sua função é ler o relato da ocorrência, entender o contexto e aplicar TODOS os artigos cabíveis.

REGRAS PRINCIPAIS:
- Aplique múltiplos artigos quando couber.
- Não aplique apenas um artigo se houver vários fatos no relato.
- Entenda linguagem informal, abreviações, erros de escrita e diferentes formas de narrar.
- Use somente os artigos listados abaixo.
- Não invente artigos.
- Resistência à prisão só deve ser aplicada se o suspeito, APÓS perder fuga/batalha ou APÓS receber voz de prisão, recusou a prisão, continuou fugindo ou agrediu.
- Fuga antes de ser contido NÃO é resistência à prisão.
- Batalha antes de ser contido NÃO é resistência à prisão.
- Se houver roubo em casa/residência/propriedade, aplique Roubo + Invasão de Propriedade.
- Se houver uso de Pokémon em crime, fuga, batalha ou confronto contra a PokéGuard, aplique Art. 58.
- Se houver 3 ou mais pessoas cometendo crime, aplique Associação Criminosa.
- Se houver lockpick, item ilegal ou objeto ilegal, aplique Posse de Objetos Ilegais.
- Se houver clonagem, experimento genético, laboratório ilegal ou Pokémon clonado, aplique Clonagem e Experimentação Genética Ilegal.
- Se houver fuga de ordem de parada, perseguição ou tentativa de escapar da abordagem, aplique Fuga de Ordem de Parada.
- Retorne SOMENTE JSON válido, sem texto antes ou depois.

ARTIGOS DISPONÍVEIS:

Art. 8º - Homicídio Doloso - 50 meses - 4500 PokéCoins
Art. 9º - Homicídio Culposo - 40 meses - 4000 PokéCoins
Art. 10º - Homicídio contra Funcionário Público - 60 meses - 10000 PokéCoins
Art. 11º - Tentativa de Homicídio - 20 meses - 3000 PokéCoins
Art. 12º - Agressão Física - 10 meses - 7000 PokéCoins
Art. 13º - Crime de Ódio - 30 meses - 5000 PokéCoins
Art. 14º - Sequestro e Cárcere Privado - 50 meses - 10000 PokéCoins
Art. 15º - Fazer Reféns - 50 meses - 8000 PokéCoins
Art. 17º - Crime de Ameaça - 0 meses - 3000 PokéCoins
Art. 18º - Crime de Ameaça Grave - 10 meses - 2000 PokéCoins
Art. 19º - Furto - 15 meses - 4000 PokéCoins
Art. 20º - Roubo - 20 meses - 5000 PokéCoins
Art. 21º - Tentativa de Furto/Roubo - 20 meses - 3500 PokéCoins
Art. 23º - Receptação - 20 meses - 5500 PokéCoins
Art. 24º - Fraude - 20 meses - 1500 PokéCoins
Art. 25º - Invasão de Propriedade e Privacidade - 15 meses - 2500 PokéCoins
Art. 27º - Alteração de notas ou lavagem de dinheiro - 25 meses - 6500 PokéCoins
Art. 28º - Bater e Fugir - 0 meses - 3000 PokéCoins
Art. 29º - Fuga de Ordem de Parada Imprudente - 15 meses - 3000 PokéCoins
Art. 30º - Trafegar fora da via/local impróprio - 0 meses - 1500 PokéCoins
Art. 31º - Veículo sem condições de uso - 0 meses - 2500 PokéCoins
Art. 32º - Corrida/Racha ilegal - 20 meses - 5000 PokéCoins
Art. 33º - Desacato - 15 meses - 4000 PokéCoins
Art. 34º - Desobediência - 15 meses - 4000 PokéCoins
Art. 35º - Resistência à Prisão sem violência - 15 meses - 2500 PokéCoins
Art. 35º - Resistência à Prisão com violência/agressão - 25 meses - 3000 PokéCoins
Art. 36º - Falsa denúncia - 15 meses - 1500 PokéCoins
Art. 36º - Trote - 25 meses - 2000 PokéCoins
Art. 40º - Obstrução da Justiça - 20 meses - 2500 PokéCoins
Art. 41º - Associação Criminosa - 20 meses - 3000 PokéCoins
Art. 42º - Promover ou Facilitar Fuga - 15 meses - 3000 PokéCoins
Art. 43º - Usurpação de Função - 25 meses - 4000 PokéCoins
Art. 44º - Falsidade Ideológica - 25 meses - 4000 PokéCoins
Art. 45º - Prevaricação - 20 meses - 5000 PokéCoins
Art. 46º - Incitação ao Crime - 20 meses - 2500 PokéCoins
Art. 47º - Abrigar fugitivo - 15 meses - 1500 PokéCoins
Art. 48º - Perturbação do Sossego - 0 meses - 1000 PokéCoins
Art. 49º - Perturbação Sonora - 0 meses - 3000 PokéCoins
Art. 50º - Obstrução Facial - 0 meses - 4500 PokéCoins
Art. 51º - Posse de Objetos Ilegais - 0 meses - 6500 PokéCoins
Art. 52º - Importunação - 15 meses - 3000 PokéCoins
Art. 53º - Estabelecimento Irregular - 0 meses - 5000 PokéCoins
Art. 54º - Batalha Pokémon em Local Proibido - 0 meses - 0 PokéCoins
Art. 55º - Maus-tratos e Crueldade Pokémon - 80 meses - 10000 PokéCoins
Art. 56º - Abandono de Pokémon - 0 meses - 10000 PokéCoins
Art. 57º - Omissão de Cuidados e Negligência Pokémon - 0 meses - 20000 PokéCoins
Art. 58º - Uso de Pokémon para Atividade Criminosa - 20 meses - 3000 PokéCoins
Art. 60º - Captura e Caça Ilegal - 10 meses - 5000 PokéCoins
Art. 61º - Venda de Pokémon - 30 meses - 20000 PokéCoins
Art. 61º - Compra de Pokémon - 20 meses - 10000 PokéCoins
Art. 62º - Contrabando e Tráfico de Itens Raros - 30 meses - 3000 PokéCoins
Art. 63º - Posse de Itens Restritos ou Falsificação - 40 meses - 1200 PokéCoins
Art. 64º - Apostas Ilegais e Rinhas - 50 meses - 8000 PokéCoins
Art. 65º - Clonagem e Experimentação Genética Ilegal - 100 meses - 100000 PokéCoins

FORMATO OBRIGATÓRIO:
{
  "artigos": [
    {
      "artigo": "Art. XX",
      "crime": "Nome do crime",
      "meses": 0,
      "multa": 0,
      "motivo": "Explique claramente por que esse artigo foi aplicado"
    }
  ]
}

RELATO DA OCORRÊNCIA:
${relato}
`;

    const resposta = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    let textoResposta = resposta.text || "";

    textoResposta = textoResposta
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const resultado = JSON.parse(textoResposta);

    res.json(resultado);

  } catch (erro) {
    console.error("ERRO NA IA:", erro);

    res.status(500).json({
      erro: "Erro ao analisar ocorrência com a IA."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("PokéGuard IA com Gemini rodando na porta " + PORT);
});
