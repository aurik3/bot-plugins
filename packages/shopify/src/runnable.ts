import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import {
  RunnableSequence,
  RunnablePassthrough,
} from "@langchain/core/runnables";

import { formatDocumentsAsString } from "langchain/util/document";

import { getData } from "./mock/index"
import { ConversationalRetrievalQAChainInput, Products } from "./types";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";


class ShopifyRunnable {
  private CONDENSE_QUESTION_PROMPT = PromptTemplate.fromTemplate(
    `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.
    
        Chat History:
        {chat_history}
        Follow Up Input: {question}
        Standalone question:`
  );


  private ANSWER_PROMPT = PromptTemplate.fromTemplate(`Answer the question based only on the following context:
{context}

just always answer into spanish {language}
Question: {question}
`);

  runnable: RunnableSequence<ConversationalRetrievalQAChainInput, any> | undefined
  constructor(
    private embeddingModel: Embeddings,
    private model: BaseChatModel,
    private shopifyApyKey: string,
    private shopifyDomain: string,
  ) {
  }

  private chat_history: [string, string][] = []


  private formatChatHistory = (chatHistory: [string, string][]) => {
    const formattedDialogueTurns = chatHistory.map(
      (dialogueTurn) => `Human: ${dialogueTurn[0]}\nAssistant: ${dialogueTurn[1]}`
    );
    return formattedDialogueTurns.join("\n");
  };

  private build_documents(products: Products[]) {
    const documents = []
    for (const product of products) {

      documents.push({
        pageContent: `
            name: ${product.title?.replace(/<[a-z]*>/, "").replace(/\n/, "").trim()}
            description: ${product.body_html?.replace(/<[a-z]*>/, "").replace(/\n/, "").trim() ?? null}
            prices: ${product.variants.map(v => v.price).join(', ')}
            type: ${product.product_type ?? null}
            vendor: ${product.vendor.replace(/<[a-z]*>/, "").replace(/\n/, "").trim()}
            `,
        metadata: {
          ...product
        }
      })
    }

    return documents
  }


  private async retriever(products: Products[]) {

    //TODO el tema de la ingesta de datos creo que para probar manejoemos en memory luego vemos
    return (await HNSWLib.fromDocuments(
      this.build_documents(products),
      this.embeddingModel
    )).asRetriever()
  }

  protected async  getInfoStore() {
    return await getData(
      this.shopifyApyKey,
      this.shopifyDomain,
      'shop.json'
    )
  }


  async buildRunnable() {
    const products = await getData(
      this.shopifyApyKey,
      this.shopifyDomain
    )

    const standaloneQuestionChain = RunnableSequence.from([
      {
        question: (input: ConversationalRetrievalQAChainInput) => input.question,
        language: (input: ConversationalRetrievalQAChainInput) => input.language,
        chat_history: (input: ConversationalRetrievalQAChainInput) =>
          this.formatChatHistory(input.chat_history),
      },
      this.CONDENSE_QUESTION_PROMPT,
      this.model,
      new StringOutputParser(),
    ]);

    const answerChain = RunnableSequence.from([
      {
        context: (await this.retriever(products)).pipe(formatDocumentsAsString),
        question: new RunnablePassthrough(),
      },
      this.ANSWER_PROMPT,
      this.model,
    ]);

    return standaloneQuestionChain.pipe(answerChain);
  }

  async invoke(question: string, chat_history: [string, string][] = [], language?: string) {
    if (!this.runnable) {
      console.info('[RUNNABLE]: Building RAG')
      this.runnable = await this.buildRunnable()
  }

    const answer = await this.runnable.invoke({
      question,
      language: language || 'spanish',
      chat_history: chat_history && chat_history.length ? chat_history : this.chat_history || [],
    })

    this.chat_history.push([question, answer])

    if (typeof answer !== 'string') return answer?.content
    return answer
    
  }


}

export { ShopifyRunnable };