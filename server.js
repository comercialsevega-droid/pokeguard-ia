import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/analisar", async (req, res) => {
  try {
    const { relato } = req.body;

    const prompt = `
Você é a IA Penal oficial da PokéGuard.

Analise o relato da ocorrência e aplique TODOS os artigos cabíveis.

REGRAS IMPORTANTES:
- Pode aplicar vários artigos na mesma ocorrência.
- Não aplique apenas um artigo.
- Entenda linguagem informal, erros de escrita e formas diferentes de relatar.
- Aplique somente artigos da lista abaixo.
- Resistência à prisão só deve ser aplicada se o suspeito, depois de perder fuga ou batalha, recusou a prisão ou continuou tentando escapar.
- Fugir antes de perder a fuga NÃO é resistência à prisão.
- Batalhar antes de perder a batalha NÃO é resistência à prisão.
- Se houver roubo em casa/residência, aplique Roubo + Invasão de Propriedade.
- Se houver uso de Pokémon para crime, fuga ou batalha contra PokéGuard, aplique Art. 58.
- Se houver 3 ou mais envolvidos praticando crime, aplique Associação Criminosa.
- Retorne SOMENTE JSON válido.

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

FORMATO DE RESPOSTA:
{
  "artigos": [
    {
      "artigo": "Art. XX",
      "crime": "Nome do crime",
      "meses": 0,
      "multa": 0,
      "motivo": "Por que esse artigo foi aplicado"
    }
  ]
}

RELATO DA OCORRÊNCIA:
${relato}
`;

    const resposta = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const resultado = JSON.parse(resposta.choices[0].message.content);
    res.json(resultado);

  } catch (erro) {
    console.error(erro);
    res.status(500).json({
      erro: "Erro ao analisar ocorrência com a IA."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("PokéGuard IA rodando na porta " + PORT);
});
