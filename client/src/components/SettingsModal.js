import React, { useState, useEffect } from "react";
import { Modal, Form, InputNumber, Divider, Typography, Space, message, theme, Radio, Switch } from "antd";
import { ClockCircleOutlined, DeleteOutlined, FileOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

const SettingsModal = ({ visible, onClose, isDarkMode }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { token } = theme.useToken();

  // 加载设置
  useEffect(() => {
    if (visible) {
      const savedTimeout = localStorage.getItem("uploadTimeout");
      const savedUseTrash = localStorage.getItem("useTrash");
      const savedDuplicateStrategy = localStorage.getItem("duplicateStrategy");
      
      form.setFieldsValue({
        uploadTimeout: savedTimeout ? parseInt(savedTimeout) / 1000 : 120, // 转换为秒
        useTrash: savedUseTrash !== null ? savedUseTrash === "true" : true, // 默认使用回收站
        duplicateStrategy: savedDuplicateStrategy || "timestamp", // 默认timestamp
      });
    }
  }, [visible, form]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();
      
      // 保存到 localStorage
      const timeoutMs = values.uploadTimeout * 1000;
      localStorage.setItem("uploadTimeout", timeoutMs.toString());
      localStorage.setItem("useTrash", values.useTrash.toString());
      localStorage.setItem("duplicateStrategy", values.duplicateStrategy);
      
      message.success("设置已保存");
      
      // 延迟关闭，让用户看到成功消息
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (error) {
      console.error("保存设置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    form.setFieldsValue({
      uploadTimeout: 120, // 默认120秒
      useTrash: true, // 默认使用回收站
      duplicateStrategy: "timestamp", // 默认timestamp
    });
  };

  return (
    <Modal
      open={visible}
      title={null}
      footer={null}
      onCancel={onClose}
      width={500}
      centered
      modalRender={(modal) => (
        <div
          style={{
            background: isDarkMode ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRadius: 24,
            boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
            border: `1px solid ${isDarkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.4)"}`,
            padding: 0,
            overflow: "hidden",
          }}
        >
          {modal}
        </div>
      )}
      styles={{
        content: {
          background: "transparent",
          boxShadow: "none",
          padding: 0,
        },
        body: {
          padding: 0,
        },
      }}
    >
      <div style={{ padding: "32px 32px 24px" }}>
        <Title level={3} style={{ marginBottom: 24, marginTop: 0 }}>
          系统设置
        </Title>

        <Form form={form} layout="vertical" requiredMark={false}>
          <Divider orientation="left" style={{ marginTop: 0 }}>
            <Space>
              <ClockCircleOutlined />
              <Text strong>超时设置</Text>
            </Space>
          </Divider>

          <Form.Item
            name="uploadTimeout"
            label="单个文件上传超时时间"
            tooltip="每张图片上传的最大等待时间，超过此时间将显示超时错误"
            rules={[
              { required: true, message: "请输入超时时间" },
              {
                type: "number",
                min: 10,
                max: 600,
                message: "超时时间必须在 10-600 秒之间",
              },
            ]}
          >
            <InputNumber
              min={10}
              max={600}
              step={10}
              addonAfter="秒"
              style={{ width: "100%" }}
              placeholder="120"
            />
          </Form.Item>

          <Text type="secondary" style={{ fontSize: 12 }}>
            说明：上传多张图片时，每张图片都有独立的超时计时。建议根据网络速度和文件大小调整此值。
          </Text>

          <Divider orientation="left">
            <Space>
              <DeleteOutlined />
              <Text strong>删除设置</Text>
            </Space>
          </Divider>

          <Form.Item
            name="useTrash"
            label="删除方式"
            tooltip="开启后删除的文件会移动到.trash目录，关闭则永久删除"
            valuePropName="checked"
          >
            <Switch 
              checkedChildren="使用回收站" 
              unCheckedChildren="永久删除"
            />
          </Form.Item>

          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: -16, marginBottom: 16 }}>
            说明：使用回收站可以防止误删，文件会保存在 .trash 目录中。永久删除则会立即删除文件。
          </Text>

          <Divider orientation="left">
            <Space>
              <FileOutlined />
              <Text strong>文件命名策略</Text>
            </Space>
          </Divider>

          <Form.Item
            name="duplicateStrategy"
            label="重名文件处理"
            tooltip="当上传同名文件时的处理方式"
          >
            <Radio.Group>
              <Space direction="vertical">
                <Radio value="timestamp">
                  时间戳 + 计数器
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    (example_1234567890_1.png)
                  </Text>
                </Radio>
                <Radio value="counter">
                  仅计数器
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    (example_1.png)
                  </Text>
                </Radio>
                <Radio value="overwrite">
                  直接覆盖
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    (覆盖原文件)
                  </Text>
                </Radio>
              </Space>
            </Radio.Group>
          </Form.Item>

          <Text type="secondary" style={{ fontSize: 12 }}>
            💡 提示：若使用"永久删除"模式 + "直接覆盖"策略，删除后重传同名文件不会添加后缀。
          </Text>

          <Divider />

          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={handleReset}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${isDarkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)"}`,
                background: "transparent",
                color: isDarkMode ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)",
                cursor: "pointer",
                transition: "all 0.3s",
              }}
              onMouseEnter={(e) => {
                e.target.style.background = isDarkMode
                  ? "rgba(255,255,255,0.1)"
                  : "rgba(0,0,0,0.05)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "transparent";
              }}
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
                color: isDarkMode ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)",
                cursor: "pointer",
                transition: "all 0.3s",
              }}
              onMouseEnter={(e) => {
                e.target.style.background = isDarkMode
                  ? "rgba(255,255,255,0.15)"
                  : "rgba(0,0,0,0.1)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = isDarkMode
                  ? "rgba(255,255,255,0.1)"
                  : "rgba(0,0,0,0.06)";
              }}
            >
              取消
            </button>
            <button
              type="submit"
              onClick={handleSave}
              disabled={loading}
              style={{
                padding: "8px 24px",
                borderRadius: 8,
                border: "none",
                background: token.colorPrimary,
                color: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                transition: "all 0.3s",
              }}
              onMouseEnter={(e) => {
                if (!loading) e.target.style.filter = "brightness(1.1)";
              }}
              onMouseLeave={(e) => {
                e.target.style.filter = "brightness(1)";
              }}
            >
              {loading ? "保存中..." : "保存设置"}
            </button>
          </Space>
        </Form>
      </div>
    </Modal>
  );
};

export default SettingsModal;
