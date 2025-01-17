import Attachments from '@components/Shared/Attachments';
import { AudioPublicationSchema } from '@components/Shared/Audio';
import withLexicalContext from '@components/Shared/Lexical/withLexicalContext';
import { Button } from '@components/UI/Button';
import { Card } from '@components/UI/Card';
import { ErrorMessage } from '@components/UI/ErrorMessage';
import { Spinner } from '@components/UI/Spinner';
import useBroadcast from '@components/utils/hooks/useBroadcast';
import type { LensterAttachment, LensterPublication } from '@generated/types';
import type { IGif } from '@giphy/js-types';
import { ChatAlt2Icon, PencilAltIcon } from '@heroicons/react/outline';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import getSignature from '@lib/getSignature';
import getTags from '@lib/getTags';
import getTextNftUrl from '@lib/getTextNftUrl';
import getUserLocale from '@lib/getUserLocale';
import { Leafwatch } from '@lib/leafwatch';
import onError from '@lib/onError';
import splitSignature from '@lib/splitSignature';
import trimify from '@lib/trimify';
import uploadToArweave from '@lib/uploadToArweave';
import { LensHubProxy } from 'abis';
import clsx from 'clsx';
import {
  ALLOWED_AUDIO_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  APP_NAME,
  LENSHUB_PROXY,
  RELAY_ON,
  SIGN_WALLET
} from 'data/constants';
import type { CreatePublicCommentRequest } from 'lens';
import {
  CollectModules,
  PublicationMainFocus,
  ReferenceModules,
  useCreateCommentTypedDataMutation,
  useCreateCommentViaDispatcherMutation,
  useCreatePostTypedDataMutation,
  useCreatePostViaDispatcherMutation
} from 'lens';
import { $getRoot } from 'lexical';
import dynamic from 'next/dynamic';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from 'src/store/app';
import { useCollectModuleStore } from 'src/store/collect-module';
import { usePublicationStore } from 'src/store/publication';
import { useReferenceModuleStore } from 'src/store/reference-module';
import { useTransactionPersistStore } from 'src/store/transaction';
import { COMMENT, POST } from 'src/tracking';
import { v4 as uuid } from 'uuid';
import { useContractWrite, useSignTypedData } from 'wagmi';

import Editor from './Editor';

const Attachment = dynamic(() => import('@components/Composer/Actions/Attachment'), {
  loading: () => <div className="mb-1 w-5 h-5 rounded-lg shimmer" />
});
const Giphy = dynamic(() => import('@components/Composer/Actions/Giphy'), {
  loading: () => <div className="mb-1 w-5 h-5 rounded-lg shimmer" />
});
const CollectSettings = dynamic(() => import('@components/Composer/Actions/CollectSettings'), {
  loading: () => <div className="mb-1 w-5 h-5 rounded-lg shimmer" />
});
const ReferenceSettings = dynamic(() => import('@components/Composer/Actions/ReferenceSettings'), {
  loading: () => <div className="mb-1 w-5 h-5 rounded-lg shimmer" />
});
const AccessSettings = dynamic(() => import('@components/Composer/Actions/AccessSettings'), {
  loading: () => <div className="mb-1 w-5 h-5 rounded-lg shimmer" />
});

interface Props {
  publication: LensterPublication;
}

const NewPublication: FC<Props> = ({ publication }) => {
  // App store
  const userSigNonce = useAppStore((state) => state.userSigNonce);
  const setUserSigNonce = useAppStore((state) => state.setUserSigNonce);
  const currentProfile = useAppStore((state) => state.currentProfile);

  // Publication store
  const publicationContent = usePublicationStore((state) => state.publicationContent);
  const setPublicationContent = usePublicationStore((state) => state.setPublicationContent);
  const audioPublication = usePublicationStore((state) => state.audioPublication);
  const setShowNewPostModal = usePublicationStore((state) => state.setShowNewPostModal);

  // Transaction persist store
  const txnQueue = useTransactionPersistStore((state) => state.txnQueue);
  const setTxnQueue = useTransactionPersistStore((state) => state.setTxnQueue);

  // Collect module store
  const selectedCollectModule = useCollectModuleStore((state) => state.selectedCollectModule);
  const payload = useCollectModuleStore((state) => state.payload);
  const resetCollectSettings = useCollectModuleStore((state) => state.reset);

  // Reference module store
  const selectedReferenceModule = useReferenceModuleStore((state) => state.selectedReferenceModule);
  const onlyFollowers = useReferenceModuleStore((state) => state.onlyFollowers);
  const degreesOfSeparation = useReferenceModuleStore((state) => state.degreesOfSeparation);

  // States
  const [publicationContentError, setPublicationContentError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<LensterAttachment[]>([]);
  const [editor] = useLexicalComposerContext();

  const isComment = Boolean(publication);
  const isAudioPublication = ALLOWED_AUDIO_TYPES.includes(attachments[0]?.type);

  const onCompleted = () => {
    editor.update(() => {
      $getRoot().clear();
    });
    setPublicationContent('');
    setAttachments([]);
    resetCollectSettings();
    if (!isComment) {
      setShowNewPostModal(false);
    }
    Leafwatch.track(isComment ? COMMENT.NEW : POST.NEW);
  };

  useEffect(() => {
    setPublicationContentError('');
  }, [audioPublication]);

  useEffect(() => {
    editor.update(() => {
      $convertFromMarkdownString(publicationContent);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateOptimisticPublication = ({ txHash, txId }: { txHash?: string; txId?: string }) => {
    return {
      id: uuid(),
      ...(isComment && { parent: publication.id }),
      type: isComment ? 'NEW_COMMENT' : 'NEW_POST',
      txHash,
      txId,
      content: publicationContent,
      attachments,
      title: audioPublication.title,
      cover: audioPublication.cover,
      author: audioPublication.author
    };
  };

  const { signTypedDataAsync } = useSignTypedData({ onError });

  const { error, write } = useContractWrite({
    address: LENSHUB_PROXY,
    abi: LensHubProxy,
    functionName: isComment ? 'commentWithSig' : 'postWithSig',
    mode: 'recklesslyUnprepared',
    onSuccess: ({ hash }) => {
      onCompleted();
      setTxnQueue([generateOptimisticPublication({ txHash: hash }), ...txnQueue]);
    },
    onError
  });

  const { broadcast } = useBroadcast({
    onCompleted: (data) => {
      onCompleted();
      setTxnQueue([generateOptimisticPublication({ txId: data?.broadcast?.txId }), ...txnQueue]);
    }
  });

  const typedDataGenerator = async (generatedData: any) => {
    const { id, typedData } = generatedData;
    const {
      profileId,
      contentURI,
      collectModule,
      collectModuleInitData,
      referenceModule,
      referenceModuleInitData,
      deadline
    } = typedData.value;
    const signature = await signTypedDataAsync(getSignature(typedData));
    const { v, r, s } = splitSignature(signature);
    const sig = { v, r, s, deadline };
    const inputStruct = {
      profileId,
      contentURI,
      collectModule,
      collectModuleInitData,
      referenceModule,
      referenceModuleInitData,
      ...(isComment && {
        profileIdPointed: typedData.value.profileIdPointed,
        pubIdPointed: typedData.value.pubIdPointed
      }),
      sig
    };

    setUserSigNonce(userSigNonce + 1);
    if (!RELAY_ON) {
      return write?.({ recklesslySetUnpreparedArgs: [inputStruct] });
    }

    const {
      data: { broadcast: result }
    } = await broadcast({ request: { id, signature } });

    if ('reason' in result) {
      write?.({ recklesslySetUnpreparedArgs: [inputStruct] });
    }
  };

  const [createCommentTypedData] = useCreateCommentTypedDataMutation({
    onCompleted: ({ createCommentTypedData }) => typedDataGenerator(createCommentTypedData),
    onError
  });

  const [createPostTypedData] = useCreatePostTypedDataMutation({
    onCompleted: ({ createPostTypedData }) => typedDataGenerator(createPostTypedData),
    onError
  });

  const [createCommentViaDispatcher] = useCreateCommentViaDispatcherMutation({
    onCompleted: (data) => {
      onCompleted();
      if (data.createCommentViaDispatcher.__typename === 'RelayerResult') {
        setTxnQueue([
          generateOptimisticPublication({ txId: data.createCommentViaDispatcher.txId }),
          ...txnQueue
        ]);
      }
    },
    onError
  });

  const [createPostViaDispatcher] = useCreatePostViaDispatcherMutation({
    onCompleted: (data) => {
      onCompleted();
      if (data.createPostViaDispatcher.__typename === 'RelayerResult') {
        setTxnQueue([
          generateOptimisticPublication({ txId: data.createPostViaDispatcher.txId }),
          ...txnQueue
        ]);
      }
    },
    onError
  });

  const createViaDispatcher = async (request: any) => {
    const variables = {
      options: { overrideSigNonce: userSigNonce },
      request
    };

    if (isComment) {
      const { data } = await createCommentViaDispatcher({ variables: { request } });
      if (data?.createCommentViaDispatcher?.__typename === 'RelayError') {
        createCommentTypedData({ variables });
      }
    } else {
      const { data } = await createPostViaDispatcher({ variables: { request } });
      if (data?.createPostViaDispatcher?.__typename === 'RelayError') {
        createPostTypedData({ variables });
      }
    }
  };

  const getMainContentFocus = () => {
    if (attachments.length > 0) {
      if (isAudioPublication) {
        return PublicationMainFocus.Audio;
      } else if (ALLOWED_IMAGE_TYPES.includes(attachments[0]?.type)) {
        return PublicationMainFocus.Image;
      } else if (ALLOWED_VIDEO_TYPES.includes(attachments[0]?.type)) {
        return PublicationMainFocus.Video;
      }
    } else {
      return PublicationMainFocus.TextOnly;
    }
  };

  const getAnimationUrl = () => {
    if (
      attachments.length > 0 &&
      (isAudioPublication || ALLOWED_VIDEO_TYPES.includes(attachments[0]?.type))
    ) {
      return attachments[0]?.item;
    }
    return null;
  };

  const getAttachmentImage = () => {
    return isAudioPublication ? audioPublication.cover : attachments[0]?.item;
  };

  const getAttachmentImageMimeType = () => {
    return isAudioPublication ? audioPublication.coverMimeType : attachments[0]?.type;
  };

  const createPublication = async () => {
    if (!currentProfile) {
      return toast.error(SIGN_WALLET);
    }

    try {
      setIsSubmitting(true);

      if (isAudioPublication) {
        setPublicationContentError('');
        const parsedData = AudioPublicationSchema.safeParse(audioPublication);
        if (!parsedData.success) {
          const issue = parsedData.error.issues[0];
          return setPublicationContentError(issue.message);
        }
      }

      if (publicationContent.length === 0 && attachments.length === 0) {
        return setPublicationContentError(`${isComment ? 'Comment' : 'Post'} should not be empty!`);
      }

      setPublicationContentError('');
      let textNftImageUrl = null;
      if (!attachments.length && selectedCollectModule !== CollectModules.RevertCollectModule) {
        textNftImageUrl = await getTextNftUrl(
          publicationContent,
          currentProfile.handle,
          new Date().toLocaleString()
        );
      }

      const attributes = [
        {
          traitType: 'type',
          displayType: 'string',
          value: getMainContentFocus()?.toLowerCase()
        }
      ];

      if (isAudioPublication) {
        attributes.push({
          traitType: 'author',
          displayType: 'string',
          value: audioPublication.author
        });
      }

      const id = await uploadToArweave({
        version: '2.0.0',
        metadata_id: uuid(),
        description: trimify(publicationContent),
        content: trimify(publicationContent),
        external_url: `https://lenster.xyz/u/${currentProfile?.handle}`,
        image: attachments.length > 0 ? getAttachmentImage() : textNftImageUrl,
        imageMimeType: attachments.length > 0 ? getAttachmentImageMimeType() : 'image/svg+xml',
        name: isAudioPublication
          ? audioPublication.title
          : `${isComment ? 'Comment' : 'Post'} by @${currentProfile?.handle}`,
        tags: getTags(publicationContent),
        animation_url: getAnimationUrl(),
        mainContentFocus: getMainContentFocus(),
        contentWarning: null,
        attributes,
        media: attachments,
        locale: getUserLocale(),
        createdOn: new Date(),
        appId: APP_NAME
      });

      const request = {
        profileId: currentProfile?.id,
        contentURI: `https://arweave.net/${id}`,
        ...(isComment && {
          publicationId: publication.__typename === 'Mirror' ? publication?.mirrorOf?.id : publication?.id
        }),
        collectModule: payload,
        referenceModule:
          selectedReferenceModule === ReferenceModules.FollowerOnlyReferenceModule
            ? { followerOnlyReferenceModule: onlyFollowers ? true : false }
            : {
                degreesOfSeparationReferenceModule: {
                  commentsRestricted: true,
                  mirrorsRestricted: true,
                  degreesOfSeparation
                }
              }
      };

      if (currentProfile?.dispatcher?.canUseRelay) {
        await createViaDispatcher(request);
      } else {
        if (isComment) {
          await createCommentTypedData({
            variables: {
              options: { overrideSigNonce: userSigNonce },
              request: request as CreatePublicCommentRequest
            }
          });
        } else {
          await createPostTypedData({
            variables: { options: { overrideSigNonce: userSigNonce }, request }
          });
        }
      }
    } catch {
    } finally {
      setIsSubmitting(false);
    }
  };

  const setGifAttachment = (gif: IGif) => {
    const attachment = {
      item: gif.images.original.url,
      type: 'image/gif',
      altTag: gif.title
    };
    setAttachments([...attachments, attachment]);
  };

  return (
    <Card className={clsx({ 'border-none rounded-none': !isComment }, 'pb-3')}>
      {error && <ErrorMessage className="mb-3" title="Transaction failed!" error={error} />}
      <Editor />
      {publicationContentError && (
        <div className="px-5 pb-3 mt-1 text-sm font-bold text-red-500">{publicationContentError}</div>
      )}
      <div className="block items-center sm:flex px-5">
        <div className="flex items-center space-x-4">
          <Attachment attachments={attachments} setAttachments={setAttachments} />
          <Giphy setGifAttachment={(gif: IGif) => setGifAttachment(gif)} />
          <CollectSettings />
          <ReferenceSettings />
          <AccessSettings />
        </div>
        <div className="ml-auto pt-2 sm:pt-0">
          <Button
            disabled={isSubmitting}
            icon={
              isSubmitting ? (
                <Spinner size="xs" />
              ) : isComment ? (
                <ChatAlt2Icon className="w-4 h-4" />
              ) : (
                <PencilAltIcon className="w-4 h-4" />
              )
            }
            onClick={createPublication}
          >
            {isComment ? 'Comment' : 'Post'}
          </Button>
        </div>
      </div>
      <div className="px-5">
        <Attachments attachments={attachments} setAttachments={setAttachments} isNew />
      </div>
    </Card>
  );
};

export default withLexicalContext(NewPublication);
