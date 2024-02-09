import { EVENTS, addKeyword } from '@bot-whatsapp/bot'
import { ClassManager } from '../../ioc'
import { Runnable } from '../../rag/runnable'
import { generateTimer } from '../../utils/generateTimer'

export default addKeyword(EVENTS.ACTION)
  .addAction(async (ctx, { state, flowDynamic }) => {
    // const history = state.get<{ role: 'user' | 'assisten', content: string }[]>('history') ?? []

    const history = []

    const runnable = ClassManager.hub().get<Runnable>('runnable')
    const textLarge = await runnable.toAsk(ctx.name, ctx.body, history)

    const chunks = textLarge.split(/(?<!\d)\.\s+/g);
    for (const chunk of chunks) {
      await flowDynamic([{ body: chunk.trim(), delay: generateTimer(150, 250) }]);
    }

  })
