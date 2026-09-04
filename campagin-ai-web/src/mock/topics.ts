import type { BrandConfig, TopicConfig, TopicThreshold } from "@/types";

/** Topic / Consumer Group 清单来自设计原型 index.html:39，共 33 项。 */
const topicPairs: [string, string][] = [
  ["campaignNoticeAutoTopic", "campaign_global_mutex_auto_group"],
  ["campaignNoticeGlobalTopic", "campaign_global_mutex_group"],
  ["campaign_setting_topic", "campaign_setting_group"],
  ["campaign_blacklist_update_topic", "campaign_blacklist_update_group"],
  ["user_idProof_topic", "user_sumsub_campaign_group"],
  ["campaign_user_upgrade_ib_topic", "campaign_user_upgrade_ib_group"],
  ["campaignAbsoluteExclusiveTopic", "campaignAbsoluteExclusiveGroup"],
  ["campaignUserLoginNoticeTopic", "campaignUserLoginNoticeGroup"],
  ["campaign_user_status_update_topic", "campaign_user_status_update_group"],
  ["campaignNoticeTopic", "campaignNoticeGroup"],
  ["campaignNoticeDepositTopic", "campaignNoticeDepositGroup"],
  ["campaign_blacklist_whitelist_update_topic", "campaign_blacklist_whitelist_update_group"],
  ["campaignUserToMarketoDepositBonusTopic", "campaignUserToMarketoDepositBonusGroup"],
  ["tradingRewardOptInConsumerTopic", "tradingRewardKafkaGroup"],
  ["MT4_Open_Trade", "campaign-atom"],
  ["MT4_Close_Trade", "campaign-atom"],
  ["MT5_Open_Trade", "campaign-atom"],
  ["MT5_Close_Trade", "campaign-atom"],
  ["MT4_Open_Trade_Demo", "campaign-atom-demo"],
  ["MT4_Close_Trade_Demo", "campaign-atom-demo"],
  ["MT5_Open_Trade_Demo", "campaign-atom-demo"],
  ["MT5_Close_Trade_Demo", "campaign-atom-demo"],
  ["campaign_base_topic", "campaign-atom"],
  ["atom_campaign_black_white_topic", "campaign-atom"],
  ["campaign_inactive_topic", "campaign-atom"],
  ["atom_eligibility_prewarm_topic", "campaign-atom"],
  ["risk_global_blacklist_topic", "campaign-atom"],
  ["atom_user_opt_in_campaign_topic", "campaign-atom"],
  ["campaign_list_auto_opt_in_topic", "campaign-atom"],
  ["user_relation_notify_topic", "campaign-atom"],
  ["luban_transfer_kafka_topic", "campaign-atom"],
  ["deposit_job_assure", "campaign-atom"],
  ["withdraw_job_assure", "campaign-atom"],
];

/** 阈值默认 -1，表示不设置告警阈值。 */
const defaultTopics = (): TopicThreshold[] =>
  topicPairs.map(([topic, consumer_group]) => ({ topic, consumer_group, threshold: -1 }));

export const topicBrandConfigs: BrandConfig<TopicConfig>[] = [
  { brand: "au", label: "AU", config: { topics: defaultTopics() } },
  { brand: "vt", label: "VT", config: { topics: defaultTopics() } },
];

export const topicCount = topicPairs.length;
